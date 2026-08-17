import * as vscode from "vscode";
import type { StreamEvent } from "../transport/sse";
import { usageFromPayload, type OpenCodeUsageSnapshot } from "../usage/domain";
import { parseToolArguments } from "./request";

export const USAGE_MIME_TYPE = "usage";
export const OPENCODE_USAGE_MIME_TYPE = "application/vnd.opencode.usage+json";

export function reportStreamEvent(
  event: StreamEvent,
  progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
  modelId: string,
  restoreToolName: (name: string) => string = (name) => name,
): OpenCodeUsageSnapshot | undefined {
  if (event.text) progress.report(new vscode.LanguageModelTextPart(event.text));
  if (event.reasoning) {
    const ThinkingPart = (vscode as unknown as { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart }).LanguageModelThinkingPart;
    if (ThinkingPart) progress.report(new ThinkingPart(event.reasoning));
  }
  for (const tool of event.toolCalls ?? []) {
    progress.report(new vscode.LanguageModelToolCallPart(tool.id || `opencode-tool-${String(Date.now())}`, restoreToolName(tool.name), parseToolArguments(tool.arguments)));
  }
  if (!event.usage) return undefined;
  const usage = usageFromPayload(event.usage, modelId);
  const native = {
    ...(usage.inputTokens === undefined ? {} : { prompt_tokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { completion_tokens: usage.outputTokens }),
    ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
  };
  progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(native)), USAGE_MIME_TYPE));
  progress.report(new vscode.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(event.usage)), OPENCODE_USAGE_MIME_TYPE));
  return usage;
}
