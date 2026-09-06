/**
 * Streamed chat-completions engine for inline completions.
 *
 * Streams a fill-in-the-middle request and returns only visible content —
 * hidden reasoning deltas are counted and discarded so a reasoning-first
 * model can never leak chain-of-thought into ghost text. Requests are tiny,
 * time-bounded, and cancellation-aware; superseded runs are aborted upstream.
 */

import { buildCompletionPrompt, stripSpecialTokens } from "./prompt";
import type { CompletionContext, CompletionResult } from "./types";

export type Fetcher = typeof fetch;

export interface ChatCompletionEngineOptions {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly fetcher?: Fetcher;
  readonly log?: (message: string) => void;
}

/** Extract visible content from one SSE `data:` payload. Pure. */
export function parseSseContentDelta(payload: string): string {
  if (!payload.startsWith("{")) return "";
  let event: unknown;
  try {
    event = JSON.parse(payload) as unknown;
  } catch {
    return "";
  }
  if (!event || typeof event !== "object") return "";
  const choice = (event as { choices?: unknown }).choices;
  if (!Array.isArray(choice)) return "";
  const first = choice[0] as { delta?: { content?: unknown }; text?: unknown } | undefined;
  const content = first?.delta?.content ?? first?.text;
  return typeof content === "string" ? content : "";
}

export class ChatCompletionEngine {
  private readonly fetcher: Fetcher;

  constructor(private readonly options: ChatCompletionEngineOptions) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async complete(context: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
    const started = Date.now();
    const prompt = buildCompletionPrompt(context.prefix, context.suffix, context.modelId);
    const body = JSON.stringify({
      model: context.modelId,
      messages: prompt.messages,
      stream: true,
      max_tokens: context.maxTokens,
      temperature: 0,
      ...prompt.extra,
    });
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeout]);
    this.options.log?.(`[completions] model=${context.modelId} prefixChars=${context.prefix.length} suffixChars=${context.suffix.length}`);
    let response: Response;
    try {
      response = await this.fetcher(this.options.url, {
        method: "POST",
        headers: { ...this.options.headers, "Content-Type": "application/json", Accept: "text/event-stream, application/json" },
        body,
        signal: requestSignal,
      });
    } catch (error) {
      if (signal.aborted) return { text: undefined, durationMs: Date.now() - started };
      throw new Error(`OpenCode completion request failed: ${messageOf(error)}`);
    }
    if (!response.ok) {
      // Upstream error bodies can echo prompt context; never surface them.
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`OpenCode completion request failed (${response.status})`);
    }
    if (!response.body) throw new Error("OpenCode returned an empty completion stream");
    const clean = stripSpecialTokens(await readContentStream(response.body, requestSignal));
    return { text: clean.trim() ? clean : undefined, durationMs: Date.now() - started };
  }
}

async function readContentStream(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        content += parseSseContentDelta(payload);
      }
    }
  } finally {
    reader.releaseLock();
    if (signal.aborted) await reader.cancel().catch(() => undefined);
  }
  return content;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}