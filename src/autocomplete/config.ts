/**
 * Configuration surface for experimental inline code suggestions.
 *
 * Suggestions are strictly opt-in: `opencode.inlineSuggestions` defaults to
 * false and nothing is registered differently when disabled — the provider
 * checks the setting live on every request so toggling needs no reload.
 */

export const CONFIG_SECTION = "opencode";

export const INLINE_SUGGESTIONS_SETTING = "inlineSuggestions";
export const INLINE_SUGGESTIONS_GATEWAY_SETTING = "inlineSuggestionsGateway";
export const INLINE_SUGGESTIONS_MODEL_SETTING = "inlineSuggestionsModel";
export const INLINE_SUGGESTIONS_CHAT_INPUT_SETTING = "inlineSuggestionsChatInput";
export const INLINE_DEBOUNCE_MS_SETTING = "inlineSuggestionsDebounceMs";
export const INLINE_TIMEOUT_MS_SETTING = "inlineSuggestionsTimeoutMs";
export const INLINE_MAX_TOKENS_SETTING = "inlineSuggestionsMaxTokens";
export const INLINE_PREFIX_LINES_SETTING = "inlineSuggestionsPrefixLines";
export const INLINE_SUFFIX_CHARS_SETTING = "inlineSuggestionsSuffixChars";

/** Gateway used for completion requests; independent of the chat provider. */
export type InlineGateway = "zen" | "go";

export const DEFAULT_INLINE_GATEWAY: InlineGateway = "go";
/** Live-measured non-thinking default (Go gateway, `enable_thinking: false`). */
export const DEFAULT_INLINE_MODEL = "qwen3.7-plus";
export const DEFAULT_INLINE_DEBOUNCE_MS = 300;
export const DEFAULT_INLINE_TIMEOUT_MS = 3_000;
export const DEFAULT_INLINE_MAX_TOKENS = 128;
export const DEFAULT_INLINE_PREFIX_LINES = 10;
export const DEFAULT_INLINE_SUFFIX_CHARS = 300;
export const DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT = false;

export const INLINE_SUGGESTIONS_DOC = "Provide experimental ghost-text inline completions while typing.";
export const INLINE_GATEWAY_DESCRIPTION = "OpenCode gateway used for inline completion requests, independent of the chat provider in use.";
export const INLINE_MODEL_DESCRIPTION = "Model id used for inline completions. Use a model that supports a genuine non-thinking mode, such as qwen3.7-plus (Go) or qwen3.6-plus (Zen).";
export const INLINE_CHAT_INPUT_DESCRIPTION = "Also offer inline completions inside the Copilot Chat prompt box.";
export const INLINE_DEBOUNCE_DESCRIPTION = "Debounce window in milliseconds between typing and an inline completion request.";
export const INLINE_TIMEOUT_DESCRIPTION = "Per-request timeout in milliseconds for inline completions.";
export const INLINE_MAX_TOKENS_DESCRIPTION = "Maximum tokens generated per inline completion.";
export const INLINE_PREFIX_LINES_DESCRIPTION = "Lines of context sent before the cursor.";
export const INLINE_SUFFIX_CHARS_DESCRIPTION = "Characters of context sent after the cursor.";

export function parseInlineGateway(value: unknown): InlineGateway {
  return value === "zen" ? "zen" : DEFAULT_INLINE_GATEWAY;
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}