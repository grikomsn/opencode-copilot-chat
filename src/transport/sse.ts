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
  /** Final completion reason observed on the stream, exposed for end-of-stream validation. */
  finishReason: string | undefined;
  private messageUsage: Record<string, unknown> = {};
  private terminalEventSeen = false;
  private textDeltaSeen = false;

  constructor(private readonly endpoint: "chat-completions" | "messages" | "responses" | "google") {}

  get completed(): boolean { return this.terminalEventSeen; }

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
    const tools = this.flushTools(true);
    if (tools.length) events.push({ toolCalls: tools });
    return events;
  }

  private parseBlock(block: string): StreamEvent | undefined {
    const lines = block.split(/\r?\n/);
    const eventName = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
    if (!data) return undefined;
    if (data === "[DONE]") {
      this.terminalEventSeen = true;
      this.finishReason = this.finishReason ?? "stop";
      return { done: true, finishReason: this.finishReason, toolCalls: this.flushTools(true) };
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
    if (type === "response.output_text.delta" || type === "response.text.delta") {
      const text = string(json.delta);
      if (text) this.textDeltaSeen = true;
      return text ? { text } : undefined;
    }
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
    if (type === "response.function_call_arguments.done") {
      // Parallel tool calls interleave deltas and done events; flushing only
      // this tool guarantees a still-streaming sibling is neither emitted
      // prematurely nor aborted with an incomplete-arguments error.
      const id = string(json.call_id) ?? string(json.item_id) ?? string(json.output_index) ?? "0";
      const item = record(json.item) ?? json;
      const tool = this.tools.get(id) ?? { id, name: "", arguments: "" };
      const name = string(json.name) ?? string(item.name);
      if (name) tool.name = name;
      const args = string(json.arguments) ?? string(item.arguments);
      if (args) tool.arguments = args;
      this.tools.set(id, tool);
      return this.emitSingleToolCall(tool.id);
    }
    if (type === "response.output_item.done") {
      const item = record(json.item) ?? json;
      // A completed message/text item must not flush sibling tool calls that
      // are still accumulating undetruer parallel tool invocation.
      const itemType = string(item.type);
      if (itemType && itemType !== "function_call") return undefined;
      const id = string(item.call_id) ?? string(item.item_id) ?? string(item.id) ?? "0";
      const tool = this.tools.get(id) ?? { id, name: string(item.name) ?? "", arguments: "" };
      if (string(item.name)) tool.name = string(item.name)!;
      if (string(item.arguments)) tool.arguments = string(item.arguments)!;
      this.tools.set(id, tool);
      return this.emitSingleToolCall(tool.id);
    }
    if (type === "response.completed" || type === "response.done") {
      this.terminalEventSeen = true;
      const response = record(json.response) ?? json;
      const status = string(response.status);
      const finishReason = status === "incomplete" ? "length" : "stop";
      this.finishReason = finishReason;
      const usage = record(response.usage) ?? record(json.usage);
      const tools = this.flushTools();
      const text = this.textDeltaSeen ? undefined : responseText(response);
      return { ...(text ? { text } : {}), ...(tools.length ? { toolCalls: tools } : {}), ...(usage ? { usage } : {}), finishReason, done: true };
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
    if (type === "message_stop") {
      this.terminalEventSeen = true;
      return { done: true, finishReason: this.finishReason ?? "stop", toolCalls: this.flushTools(true), ...(Object.keys(this.messageUsage).length ? { usage: this.messageUsage } : {}) };
    }
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
      // Key by index when present, otherwise by the tool id: falling back to a
      // positional counter fragments parallel tool calls whose later deltas
      // arrive without an index.
      const key = typeof item.index === "number" ? String(item.index) : string(item.id) ?? `call-${this.tools.size}`;
      const current = this.tools.get(key) ?? { id: string(item.id) ?? key, name: "", arguments: "" };
      const fn = record(item.function);
      if (string(item.id)) current.id = string(item.id)!;
      const name = string(fn?.name);
      const argumentsDelta = string(fn?.arguments);
      if (name) current.name += name;
      if (argumentsDelta) current.arguments += argumentsDelta;
      this.tools.set(key, current);
    }
  }

  private collectResponseTool(value: Record<string, unknown>): void {
    const id = string(value.call_id) ?? string(value.id) ?? string(value.output_index) ?? "0";
    this.tools.set(id, { id, name: string(value.name) ?? "", arguments: string(value.arguments) ?? "" });
  }

  /**
   * Emits accumulated tool calls. Unparseable arguments stay pending until a
   * later flush unless `final`: mid-stream flushes (parallel tool calls where a
   * sibling is still streaming) must neither throw nor emit malformed calls,
   * while stream-end flushes surface genuine truncation loudly.
   */
  private flushTools(final = false): ToolCallEvent[] {
    const events: ToolCallEvent[] = [];
    for (const [key, tool] of [...this.tools]) {
      if (this.completedTools.has(tool.id)) {
        this.tools.delete(key);
        continue;
      }
      if (!tool.name) {
        if (final) this.tools.delete(key);
        continue;
      }
      const args = tool.arguments.trim() || "{}";
      if (isParseableJson(args)) {
        this.tools.delete(key);
        this.completedTools.add(tool.id);
        events.push({ ...tool, arguments: args });
        continue;
      }
      if (final) {
        this.tools.delete(key);
        throw new Error(`OpenCode stream ended with incomplete arguments for tool ${tool.name}`);
      }
    }
    return events;
  }

  /** Emits exactly one tool call identified by its id, leaving siblings untouched. */
  private emitSingleToolCall(id: string): StreamEvent | undefined {
    if (this.completedTools.has(id)) return undefined;
    for (const [key, tool] of [...this.tools]) {
      if (tool.id !== id || !tool.name) continue;
      const args = tool.arguments.trim() || "{}";
      if (!isParseableJson(args)) return undefined;
      this.tools.delete(key);
      this.completedTools.add(tool.id);
      return { toolCalls: [{ ...tool, arguments: args }] };
    }
    return undefined;
  }
}

/** Finish reasons that mean the response was cut short by the model's output cap. */
const OUTPUT_LIMIT_REASONS = new Set(["length", "max_tokens", "max_output_tokens"]);
/** Finish reasons that mean the response was cut short by a safety or refusal mechanism. */
const CONTENT_FILTER_REASONS = new Set(["content_filter", "safety", "recitation", "blocklist", "prohibited_content", "spii", "refusal"]);

/**
 * Surfaces truncated or filtered streams instead of letting Copilot Chat end the
 * turn silently. Mirrors the sibling providers: a stream with no completion
 * reason ended before the model finished, an output-limit reason means the
 * response was cut off at the cap, and a filter reason means the model refused.
 * Unknown reasons (end_turn, tool_use, STOP, pause_turn, …) are dialect-specific
 * success codes and pass.
 */
export function validateStreamCompletion(modelId: string, finishReason: string | undefined): void {
  const reason = finishReason?.toLowerCase();
  if (reason && OUTPUT_LIMIT_REASONS.has(reason)) {
    throw new Error(`OpenCode model ${modelId} reached its output token limit before completing`);
  }
  if (reason && CONTENT_FILTER_REASONS.has(reason)) {
    throw new Error(`OpenCode stopped the response for ${modelId} because of its content filter`);
  }
  if (!reason) {
    throw new Error(`OpenCode response stream ended before ${modelId} reported a completion reason`);
  }
}

function isParseableJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function responseText(response: Record<string, unknown>): string | undefined {
  const output = Array.isArray(response.output) ? response.output : [];
  const text = output.flatMap((raw) => {
    const item = record(raw);
    if (!item || item.type !== "message" || !Array.isArray(item.content)) return [];
    return item.content.flatMap((rawPart) => {
      const part = record(rawPart);
      const value = string(part?.text);
      return value && (part?.type === "output_text" || part?.type === "text") ? [value] : [];
    });
  }).join("");
  return text || undefined;
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
