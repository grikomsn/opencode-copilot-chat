import * as vscode from "vscode";
import { joinTextParts, stringifyWellFormedJson } from "../kit/unicode";
import { convertChatMessages as convertKitChatMessages, type ChatMessage } from "../kit/messages";

export type { ChatMessage } from "../kit/messages";

const MAX_INLINE_IMAGE_BYTES = 3_750_000;

export interface ResponsesItem {
  type: "message" | "function_call" | "function_call_output";
  role?: "user" | "assistant";
  content?: string | Array<{ type: "input_text" | "input_image"; text?: string; image_url?: string }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
}

/**
 * Chat Completions history for every OpenCode gateway: thinking is replayed as
 * `reasoning_content`, and oversized inline images become placeholders.
 */
export function convertChatMessages(messages: readonly vscode.LanguageModelChatRequestMessage[]): ChatMessage[] {
  return convertKitChatMessages(messages, vscode, {
    label: "OpenCode",
    imageInput: true,
    replayReasoning: true,
    maxInlineImageBytes: MAX_INLINE_IMAGE_BYTES,
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
        calls.push({ type: "function_call", call_id: part.callId, name: part.name, arguments: stringifyWellFormedJson(part.input ?? {}) });
      } else if (part instanceof vscode.LanguageModelToolResultPart) {
        results.push({ type: "function_call_output", call_id: part.callId, output: joinTextParts(part.content.map(partText)) });
      }
    }
    const value = joinTextParts(text);
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
