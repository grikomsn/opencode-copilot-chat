import * as vscode from "vscode";

const MAX_INLINE_IMAGE_BYTES = 3_750_000;

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ResponsesItem {
  type: "message" | "function_call" | "function_call_output";
  role?: "user" | "assistant";
  content?: string | Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

export function convertChatMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
  return messages.flatMap((message) => {
    const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    const text: string[] = [];
    const reasoning: string[] = [];
    const images: ContentPart[] = [];
    const toolCalls: ChatMessage["tool_calls"] = [];
    const results: ChatMessage[] = [];
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
      else if (isThinkingPart(part)) reasoning.push(...thinkingText(part));
      else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
        if (part.data.byteLength <= MAX_INLINE_IMAGE_BYTES) images.push({ type: "image_url", image_url: { url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` } });
        else text.push(`[Image omitted: ${String(part.data.byteLength)} bytes exceeds the provider-safe inline limit]`);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        toolCalls.push({ id: part.callId, type: "function", function: { name: part.name, arguments: JSON.stringify(part.input ?? {}) } });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        results.push({ role: "tool", tool_call_id: part.callId, content: part.content.map(partText).join("\n") });
      }
    }
    const value = text.join("\n");
    const content: string | ContentPart[] | null = images.length
      ? [...(value ? [{ type: "text" as const, text: value }] : []), ...images]
      : value || null;
    const current: ChatMessage = {
      role,
      content,
      ...(role === "assistant" && reasoning.length ? { reasoning_content: reasoning.join("\n") } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    };
    return results.length ? [current, ...results] : [current];
  });
}

export function convertResponsesMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ResponsesItem[] {
  return messages.flatMap((message) => {
    const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
    const text: string[] = [];
    const images: Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }> = [];
    const calls: ResponsesItem[] = [];
    const results: ResponsesItem[] = [];
    for (const part of message.content) {
      if (part instanceof vscode.LanguageModelTextPart) text.push(part.value);
      else if (part instanceof vscode.LanguageModelDataPart && part.mimeType.startsWith("image/")) {
        if (part.data.byteLength <= MAX_INLINE_IMAGE_BYTES) images.push({ type: "input_image", image_url: `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}` });
        else text.push(`[Image omitted: ${String(part.data.byteLength)} bytes exceeds the provider-safe inline limit]`);
      } else if (part instanceof vscode.LanguageModelToolCallPart) {
        calls.push({ type: "function_call", call_id: part.callId, name: part.name, arguments: JSON.stringify(part.input ?? {}) });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        results.push({ type: "function_call_output", call_id: part.callId, output: part.content.map(partText).join("\n") });
      }
    }
    const value = text.join("\n");
    const content = images.length ? [...(value ? [{ type: "input_text" as const, text: value }] : []), ...images] : value;
    const items: ResponsesItem[] = [];
    if (content || (!calls.length && !results.length)) items.push({ type: "message", role, content });
    items.push(...(role === "assistant" ? calls : results));
    return items;
  });
}

function partText(part: vscode.LanguageModelInputPart | unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) return part.value;
  if (part instanceof vscode.LanguageModelToolCallPart) return JSON.stringify(part.input ?? {});
  if (part instanceof vscode.LanguageModelToolResultPart) return part.content.map(partText).join("\n");
  return typeof part === "string" ? part : "";
}

function isThinkingPart(part: unknown): part is { value: string | string[] } {
  const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: new (...args: never[]) => unknown }).LanguageModelThinkingPart;
  return Boolean(ThinkingPart && part instanceof ThinkingPart);
}

function thinkingText(part: { value: string | string[] }): string[] {
  return Array.isArray(part.value) ? part.value : [part.value];
}
