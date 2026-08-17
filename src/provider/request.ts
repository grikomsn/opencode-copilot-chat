import type { OpenCodeModel } from "../models/catalog";
import { thinkingPayload, type ThinkingSelection } from "../models/options";
import type { FunctionTool } from "../tools/client-tools";
import type { ChatMessage, ResponsesItem } from "./messages";

export function buildRequestBody(
  model: OpenCodeModel,
  messages: ChatMessage[],
  responsesInput: ResponsesItem[],
  tools: readonly FunctionTool[],
  responsesTools: readonly Record<string, unknown>[],
  thinking: ThinkingSelection | undefined,
  maxOutputTokens: number,
  toolChoice: "auto" | "required",
): Record<string, unknown> {
  if (model.endpoint === "responses") {
    return {
      model: model.rawModelId,
      input: responsesInput,
      stream: true,
      store: false,
      max_output_tokens: maxOutputTokens,
      ...thinkingPayload(model, thinking),
      ...(responsesTools.length ? { tools: responsesTools, tool_choice: toolChoice, parallel_tool_calls: true } : {}),
    };
  }
  if (model.endpoint === "messages") {
    return {
      model: model.rawModelId,
      messages: anthropicMessages(messages),
      max_tokens: maxOutputTokens,
      stream: true,
      ...thinkingPayload(model, thinking),
      ...(tools.length ? { tools: anthropicTools(tools), tool_choice: toolChoice === "required" ? { type: "any" } : { type: "auto" } } : {}),
    };
  }
  if (model.endpoint === "google") {
    return {
      contents: googleContents(messages),
      generationConfig: { maxOutputTokens, ...thinkingPayload(model, thinking) },
      ...(tools.length ? { tools: [{ functionDeclarations: tools.map((tool) => tool.function) }], toolConfig: { functionCallingConfig: { mode: toolChoice === "required" ? "ANY" : "AUTO" } } } : {}),
    };
  }
  return {
    model: model.rawModelId,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: maxOutputTokens,
    ...thinkingPayload(model, thinking),
    ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
  };
}

export function mergeRequestBody(
  modelOptions: Readonly<Record<string, unknown>> | undefined,
  requiredBody: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...(modelOptions ?? {}), ...requiredBody };
}

function anthropicTools(tools: readonly FunctionTool[]): Record<string, unknown>[] {
  return tools.map((tool) => ({ name: tool.function.name, description: tool.function.description, input_schema: tool.function.parameters }));
}

function anthropicMessages(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "tool") {
      result.push({ role: "user", content: [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "tool", content: textContent(message.content) }] });
      continue;
    }
    const content: Record<string, unknown>[] = [];
    for (const part of contentParts(message.content)) {
      if (part.type === "text" && part.text) content.push({ type: "text", text: part.text });
      if (part.type === "image_url" && part.image_url?.url) {
        const match = /^data:(.+?);base64,(.+)$/.exec(part.image_url.url);
        if (match) content.push({ type: "image", source: { type: "base64", media_type: match[1], data: match[2] } });
      }
    }
    for (const call of message.tool_calls ?? []) content.push({ type: "tool_use", id: call.id, name: call.function.name, input: parseToolArguments(call.function.arguments) });
    result.push({ role: message.role, content: content.length ? content : textContent(message.content) });
  }
  return result.length ? result : [{ role: "user", content: "Continue the conversation." }];
}

function googleContents(messages: readonly ChatMessage[]): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const toolNames = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "tool") {
      result.push({ role: "user", parts: [{ functionResponse: { name: toolNames.get(message.tool_call_id ?? "") ?? "tool", response: { content: textContent(message.content) } } }] });
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    if (message.role === "assistant" && message.reasoning_content) parts.push({ text: message.reasoning_content, thought: true });
    parts.push(...contentParts(message.content).flatMap((part): Record<string, unknown>[] => {
      if (part.type === "text" && part.text) return [{ text: part.text }];
      const match = part.image_url?.url ? /^data:(.+?);base64,(.+)$/.exec(part.image_url.url) : undefined;
      return match ? [{ inlineData: { mimeType: match[1], data: match[2] } }] : [];
    }));
    for (const call of message.tool_calls ?? []) {
      toolNames.set(call.id, call.function.name);
      parts.push({ functionCall: { name: call.function.name, args: parseToolArguments(call.function.arguments) } });
    }
    if (parts.length) result.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return result;
}

function contentParts(content: ChatMessage["content"]): Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> {
  return typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
}

function textContent(content: ChatMessage["content"]): string {
  return contentParts(content).map((part) => part.text ?? "").join("\n");
}

export function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { value };
  }
}
