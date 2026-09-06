/**
 * Inline completions registration.
 *
 * Wires the completion engine + provider into the extension. The provider
 * checks the opt-in configuration live, the gateway and model are resolved
 * per request, and the API key is read from Secret Storage on every
 * suggestion (cheap, and never cached or logged). Register once at activation;
 * toggling `opencode.inlineSuggestions` is honored on the fly.
 */

import * as vscode from "vscode";
import { randomUUID } from "node:crypto";
import { ChatCompletionEngine } from "./engine";
import { OpenCodeInlineCompletionProvider } from "./provider";
import type { CompletionContext, CompletionEngine, CompletionResult } from "./types";
import {
  clampNumber,
  CONFIG_SECTION,
  DEFAULT_INLINE_DEBOUNCE_MS,
  DEFAULT_INLINE_GATEWAY,
  DEFAULT_INLINE_MAX_TOKENS,
  DEFAULT_INLINE_MODEL,
  DEFAULT_INLINE_PREFIX_LINES,
  DEFAULT_INLINE_SUFFIX_CHARS,
  DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT,
  DEFAULT_INLINE_TIMEOUT_MS,
  INLINE_DEBOUNCE_MS_SETTING,
  INLINE_MAX_TOKENS_SETTING,
  INLINE_SUGGESTIONS_CHAT_INPUT_SETTING,
  INLINE_SUGGESTIONS_GATEWAY_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  INLINE_PREFIX_LINES_SETTING,
  INLINE_SUFFIX_CHARS_SETTING,
  INLINE_TIMEOUT_MS_SETTING,
  parseInlineGateway,
  type InlineGateway,
} from "./config";
import { apiBaseForMode, endpointUrl, OPENCODE_CLIENT } from "../transport/protocol";

export interface InlineCompletionsDeps {
  /** Resolve the stored API key for a gateway; undefined when signed out. */
  readonly resolveApiKey: (gateway: InlineGateway) => Promise<string | undefined>;
  readonly output: vscode.OutputChannel;
  readonly userAgent: string;
}

function readSetting<T>(key: string, fallback: T): T {
  const value = vscode.workspace.getConfiguration(CONFIG_SECTION).get<T>(key);
  return value === undefined ? fallback : value;
}

function readNumberSetting(key: string, fallback: number, min: number, max: number): number {
  return clampNumber(vscode.workspace.getConfiguration(CONFIG_SECTION).get<unknown>(key), fallback, min, max);
}

export function registerInlineCompletions(context: vscode.ExtensionContext, deps: InlineCompletionsDeps): vscode.Disposable {
  const log = (message: string): void => deps.output.appendLine(message);
  const sessionId = randomUUID();

  const engine: CompletionEngine = {
    id: "chat-completions",
    async complete(ctx: CompletionContext, signal: AbortSignal): Promise<CompletionResult> {
      const gateway = parseInlineGateway(readSetting(INLINE_SUGGESTIONS_GATEWAY_SETTING, DEFAULT_INLINE_GATEWAY));
      const apiKey = await deps.resolveApiKey(gateway);
      if (!apiKey) {
        log("[completions] no OpenCode API key for the selected gateway — skipping");
        return { text: undefined, durationMs: 0 };
      }
      const url = endpointUrl(apiBaseForMode(gateway), "chat-completions", ctx.modelId);
      const keyed = new ChatCompletionEngine({
        url,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream, application/json",
          "Content-Type": "application/json",
          "User-Agent": deps.userAgent,
          "x-opencode-client": OPENCODE_CLIENT,
          "x-opencode-request": randomUUID(),
          "x-opencode-session": sessionId,
        },
        timeoutMs: readNumberSetting(INLINE_TIMEOUT_MS_SETTING, DEFAULT_INLINE_TIMEOUT_MS, 500, 15_000),
        log,
      });
      return keyed.complete(ctx, signal);
    },
  };

  const provider = new OpenCodeInlineCompletionProvider({
    engine,
    isEnabled: () => readSetting(INLINE_SUGGESTIONS_SETTING, false),
    resolveModelId: () => readSetting(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL),
    resolveChatInputEnabled: () => readSetting(INLINE_SUGGESTIONS_CHAT_INPUT_SETTING, DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT),
    resolveDebounceMs: () => readNumberSetting(INLINE_DEBOUNCE_MS_SETTING, DEFAULT_INLINE_DEBOUNCE_MS, 50, 2_000),
    resolveMaxTokens: () => readNumberSetting(INLINE_MAX_TOKENS_SETTING, DEFAULT_INLINE_MAX_TOKENS, 16, 1_024),
    resolvePrefixLines: () => readNumberSetting(INLINE_PREFIX_LINES_SETTING, DEFAULT_INLINE_PREFIX_LINES, 1, 100),
    resolveSuffixChars: () => readNumberSetting(INLINE_SUFFIX_CHARS_SETTING, DEFAULT_INLINE_SUFFIX_CHARS, 0, 5_000),
  });

  const registration = vscode.languages.registerInlineCompletionItemProvider({ pattern: "**" }, provider);
  context.subscriptions.push(registration, provider);
  return registration;
}