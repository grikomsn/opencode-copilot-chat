import type * as vscode from "vscode";
import type { StreamEvent } from "../transport/sse";
import { usageFromPayload, type OpenCodeUsageSnapshot } from "../usage/domain";
import { parseToolArguments } from "./request";

export const USAGE_MIME_TYPE = "usage";
export const OPENCODE_USAGE_MIME_TYPE = "application/vnd.opencode.usage+json";

export type ResponsePartConstructors = Pick<typeof vscode,
  "LanguageModelTextPart" | "LanguageModelToolCallPart" | "LanguageModelDataPart"
> & { LanguageModelThinkingPart?: typeof vscode.LanguageModelThinkingPart };

/** One reporter per upstream request, including each retry. */
export class StreamResponseReporter {
  private thinkingOpen = false;
  private toolIndex = 0;
  /** Usage events held back while a thinking segment is open, flushed on close. */
  private pendingUsage: { normalized: OpenCodeUsageSnapshot; native: Record<string, unknown> }[] = [];

  constructor(
    private readonly progress: vscode.Progress<vscode.LanguageModelResponsePart2>,
    private readonly modelId: string,
    private readonly parts: ResponsePartConstructors,
    private readonly requestId: string,
    private readonly restoreToolName: (name: string) => string = (name) => name,
  ) {}

  report(event: StreamEvent): OpenCodeUsageSnapshot | undefined {
    // Gateways can put the last reasoning delta and first answer in one event.
    // Reporting text first splits the reasoning and reopens thinking after it.
    if (event.reasoning && this.parts.LanguageModelThinkingPart) {
      this.progress.report(new this.parts.LanguageModelThinkingPart(event.reasoning));
      this.thinkingOpen = true;
    }
    if (event.text || event.toolCalls?.length || event.finishReason || event.done) this.flushThinking();
    if (event.text) this.progress.report(new this.parts.LanguageModelTextPart(event.text));
    for (const tool of event.toolCalls ?? []) {
      this.progress.report(new this.parts.LanguageModelToolCallPart(
        tool.id || `opencode-tool-${this.requestId}-${this.toolIndex++}`,
        this.restoreToolName(tool.name),
        parseToolArguments(tool.arguments),
      ));
    }
    if (!event.usage) return undefined;
    const usage = usageFromPayload(event.usage, this.modelId);
    // Copilot Chat only merges reasoning deltas while the previous reported
    // part is also thinking; hold usage data parts until the segment closes.
    if (this.thinkingOpen) {
      this.pendingUsage.push({ normalized: usage, native: event.usage });
      return usage;
    }
    this.reportUsage(usage, event.usage);
    return usage;
  }

  /** Also close reasoning when EOF, a transport error, or a timeout ends it. */
  finish(): void {
    this.flushThinking();
  }

  private flushThinking(): void {
    if (!this.thinkingOpen) return;
    this.thinkingOpen = false;
    const ThinkingPart = this.parts.LanguageModelThinkingPart;
    if (ThinkingPart) this.progress.report(new ThinkingPart("", "", { vscode_reasoning_done: true }));
    for (const usage of this.pendingUsage.splice(0)) this.reportUsage(usage.normalized, usage.native);
  }

  private reportUsage(usage: OpenCodeUsageSnapshot, native: Record<string, unknown> | undefined): void {
    const payload = {
      ...(usage.inputTokens === undefined ? {} : { prompt_tokens: usage.inputTokens }),
      ...(usage.outputTokens === undefined ? {} : { completion_tokens: usage.outputTokens }),
      ...(usage.totalTokens === undefined ? {} : { total_tokens: usage.totalTokens }),
    };
    this.progress.report(new this.parts.LanguageModelDataPart(new TextEncoder().encode(JSON.stringify(payload)), USAGE_MIME_TYPE));
    if (native) {
      this.progress.report(new this.parts.LanguageModelDataPart(
        new TextEncoder().encode(JSON.stringify(native)), OPENCODE_USAGE_MIME_TYPE,
      ));
    }
  }
}
