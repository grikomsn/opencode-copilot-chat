export interface ToolCallEvent {
  id: string;
  name: string;
  arguments: string;
}

export interface StreamEvent {
  text?: string;
  reasoning?: string;
  toolCalls?: ToolCallEvent[];
  usage?: Record<string, unknown>;
  finishReason?: string;
  done?: boolean;
}

export class OpenCodeStreamParser {
  private buffer = "";
  private readonly tools = new Map<string, ToolCallEvent>();
  private readonly completedTools = new Set<string>();
  private finishReason: string | undefined;
  private messageUsage: Record<string, unknown> = {};

  constructor(private readonly endpoint: "chat-completions" | "messages" | "responses" | "google") {}

  push(chunk: string): StreamEvent[] {
    this.buffer += chunk;
    const events: StreamEvent[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary?.index !== undefined) {
      const block = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      const event = this.parseBlock(block);
      if (event) events.push(event);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
    }
    return events;
  }

  finish(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.buffer.trim()) {
      const event = this.parseBlock(this.buffer);
      if (event) events.push(event);
    }
    this.buffer = "";
    const tools = this.flushTools();
    if (tools.length) events.push({ toolCalls: tools });
    return events;
  }

  private parseBlock(block: string): StreamEvent | undefined {
    const lines = block.split(/\r?\n/);
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return undefined;
    if (data === "[DONE]") {
      this.finishReason = this.finishReason ?? "stop";
      return { done: true, finishReason: this.finishReason, toolCalls: this.flushTools() };
    }
    let json: Record<string, unknown>;
    try { json = JSON.parse(data) as Record<string, unknown>; } catch { return undefined; }
    if (this.endpoint === "responses" || eventName?.startsWith("response.") || typeof json.type === "string" && String(json.type).startsWith("response.")) {
      return this.parseResponses(json, eventName ?? (typeof json.type === "string" ? json.type : undefined));
    }
    if (this.endpoint === "messages") return this.parseMessages(json);
    if (this.endpoint === "google") return this.parseGoogle(json);
    return this.parseChat(json);
  }

  private parseChat(json: Record<string, unknown>): StreamEvent | undefined {
    const choices = Array.isArray(json.choices) ? json.choices : [];
    const choice = record(choices[0]);
    const delta = record(choice?.delta);
    this.collectChatTools(delta?.tool_calls);
    const finishReason = string(choice?.finish_reason);
    if (finishReason) this.finishReason = finishReason;
    const tools = finishReason ? this.flushTools() : [];
    const text = string(delta?.content);
    const reasoning = string(delta?.reasoning_content) ?? string(delta?.reasoning);
    const usage = record(json.usage);
    if (!text && !reasoning && !tools.length && !usage && !finishReason) return undefined;
    return { ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}), ...(tools.length ? { toolCalls: tools } : {}), ...(usage ? { usage } : {}), ...(finishReason ? { finishReason } : {}) };
  }

  private parseResponses(json: Record<string, unknown>, type: string | undefined): StreamEvent | undefined {
    if (type === "response.output_text.delta" || type === "response.text.delta") return string(json.delta) ? { text: string(json.delta) } : undefined;
    if (type === "response.reasoning_text.delta" || type === "response.reasoning_summary_text.delta") return string(json.delta) ? { reasoning: string(json.delta) } : undefined;
    if (type === "response.output_item.added") {
      const item = record(json.item);
      if (item?.type === "function_call") this.collectResponseTool(item);
      return undefined;
    }
    if (type === "response.function_call_arguments.delta") {
      const id = string(json.call_id) ?? string(json.item_id) ?? string(json.output_index) ?? "0";
      const tool = this.tools.get(id) ?? { id, name: string(json.name) ?? "", arguments: "" };
      tool.arguments += string(json.delta) ?? "";
      if (string(json.name)) tool.name = string(json.name)!;
      this.tools.set(id, tool);
      return undefined;
    }
    if (type === "response.function_call_arguments.done" || type === "response.output_item.done") {
      const item = record(json.item) ?? json;
      const id = string(item.call_id) ?? string(item.item_id) ?? string(item.id) ?? "0";
      const tool = this.tools.get(id) ?? { id, name: string(item.name) ?? "", arguments: "" };
      if (string(item.name)) tool.name = string(item.name)!;
      if (string(item.arguments)) tool.arguments = string(item.arguments)!;
      this.tools.set(id, tool);
      const flushed = this.flushTools();
      return flushed.length ? { toolCalls: flushed } : undefined;
    }
    if (type === "response.completed" || type === "response.done") {
      const response = record(json.response) ?? json;
      const status = string(response.status);
      const finishReason = status === "incomplete" ? "length" : "stop";
      this.finishReason = finishReason;
      const usage = record(response.usage) ?? record(json.usage);
      const tools = this.flushTools();
      return { ...(tools.length ? { toolCalls: tools } : {}), ...(usage ? { usage } : {}), finishReason, done: true };
    }
    return undefined;
  }

  private parseMessages(json: Record<string, unknown>): StreamEvent | undefined {
    const type = string(json.type);
    if (type === "message_start") {
      this.messageUsage = { ...this.messageUsage, ...(record(record(json.message)?.usage) ?? {}) };
      return undefined;
    }
    if (type === "content_block_delta") {
      const delta = record(json.delta);
      if (delta?.type === "text_delta") return string(delta.text) ? { text: string(delta.text) } : undefined;
      if (delta?.type === "thinking_delta") return string(delta.thinking) ? { reasoning: string(delta.thinking) } : undefined;
      if (delta?.type === "input_json_delta") {
        const id = indexKey(json.index);
        const tool = this.tools.get(id) ?? { id, name: "", arguments: "" };
        tool.arguments += string(delta.partial_json) ?? "";
        this.tools.set(id, tool);
        return undefined;
      }
    }
    if (type === "content_block_start") {
      const block = record(json.content_block);
      if (block?.type === "tool_use") {
        const id = string(block.id) ?? indexKey(json.index);
        const index = json.index === undefined ? id : indexKey(json.index);
        this.tools.set(index, { id, name: string(block.name) ?? "", arguments: "" });
      }
      return undefined;
    }
    if (type === "message_delta") {
      const delta = record(json.delta);
      const finishReason = string(delta?.stop_reason);
      const usage = record(json.usage);
      if (usage) this.messageUsage = { ...this.messageUsage, ...usage };
      if (finishReason) this.finishReason = finishReason;
      return { ...(usage ? { usage } : {}), ...(finishReason ? { finishReason } : {}) };
    }
    if (type === "message_stop") return { done: true, finishReason: this.finishReason ?? "stop", toolCalls: this.flushTools(), ...(Object.keys(this.messageUsage).length ? { usage: this.messageUsage } : {}) };
    return undefined;
  }

  private parseGoogle(json: Record<string, unknown>): StreamEvent | undefined {
    const candidates = Array.isArray(json.candidates) ? json.candidates : [];
    const candidate = record(candidates[0]);
    const content = record(candidate?.content);
    const parts = Array.isArray(content?.parts) ? content.parts.map(record).filter(Boolean) as Record<string, unknown>[] : [];
    const text = parts.filter((part) => part.thought !== true).map((part) => string(part.text) ?? "").join("");
    const reasoning = parts.filter((part) => part.thought === true).map((part) => string(part.text) ?? "").join("");
    const toolCalls = parts.flatMap((part, index) => {
      const call = record(part.functionCall);
      return call && string(call.name) ? [{ id: `google-tool-${String(index)}`, name: string(call.name)!, arguments: JSON.stringify(call.args ?? {}) }] : [];
    });
    const finishReason = string(candidate?.finishReason);
    const usage = record(json.usageMetadata);
    if (!text && !reasoning && !toolCalls.length && !finishReason && !usage) return undefined;
    if (finishReason) this.finishReason = finishReason;
    return { ...(text ? { text } : {}), ...(reasoning ? { reasoning } : {}), ...(toolCalls.length ? { toolCalls } : {}), ...(usage ? { usage } : {}), ...(finishReason ? { finishReason } : {}) };
  }

  private collectChatTools(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const raw of value) {
      const item = record(raw);
      if (!item) continue;
      const id = typeof item.index === "number" ? String(item.index) : String(this.tools.size);
      const current = this.tools.get(id) ?? { id: string(item.id) ?? id, name: "", arguments: "" };
      const fn = record(item.function);
      if (string(item.id)) current.id = string(item.id)!;
      const name = string(fn?.name);
      const argumentsDelta = string(fn?.arguments);
      if (name) current.name += name;
      if (argumentsDelta) current.arguments += argumentsDelta;
      this.tools.set(id, current);
    }
  }

  private collectResponseTool(value: Record<string, unknown>): void {
    const id = string(value.call_id) ?? string(value.id) ?? string(value.output_index) ?? "0";
    this.tools.set(id, { id, name: string(value.name) ?? "", arguments: string(value.arguments) ?? "" });
  }

  private flushTools(): ToolCallEvent[] {
    const values = [...new Set(this.tools.values())].filter((tool) => tool.name && !this.completedTools.has(tool.id));
    for (const tool of values) this.completedTools.add(tool.id);
    this.tools.clear();
    return values;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function indexKey(value: unknown): string {
  return typeof value === "number" && Number.isInteger(value) ? String(value) : string(value) ?? "0";
}
