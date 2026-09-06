import assert from "node:assert/strict";
import test from "node:test";
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
  INLINE_PREFIX_LINES_SETTING,
  INLINE_SUFFIX_CHARS_SETTING,
  INLINE_SUGGESTIONS_CHAT_INPUT_SETTING,
  INLINE_SUGGESTIONS_GATEWAY_SETTING,
  INLINE_SUGGESTIONS_MODEL_SETTING,
  INLINE_SUGGESTIONS_SETTING,
  INLINE_TIMEOUT_MS_SETTING,
  parseInlineGateway,
} from "./config";

test("targets the opencode configuration section with stable setting keys", () => {
  assert.equal(CONFIG_SECTION, "opencode");
  assert.equal(INLINE_SUGGESTIONS_SETTING, "inlineSuggestions");
  assert.equal(INLINE_SUGGESTIONS_GATEWAY_SETTING, "inlineSuggestionsGateway");
  assert.equal(INLINE_SUGGESTIONS_MODEL_SETTING, "inlineSuggestionsModel");
  assert.equal(INLINE_SUGGESTIONS_CHAT_INPUT_SETTING, "inlineSuggestionsChatInput");
  assert.equal(INLINE_DEBOUNCE_MS_SETTING, "inlineSuggestionsDebounceMs");
  assert.equal(INLINE_TIMEOUT_MS_SETTING, "inlineSuggestionsTimeoutMs");
  assert.equal(INLINE_MAX_TOKENS_SETTING, "inlineSuggestionsMaxTokens");
  assert.equal(INLINE_PREFIX_LINES_SETTING, "inlineSuggestionsPrefixLines");
  assert.equal(INLINE_SUFFIX_CHARS_SETTING, "inlineSuggestionsSuffixChars");
});

test("keeps the documented inline-suggestion defaults", () => {
  assert.equal(DEFAULT_INLINE_GATEWAY, "go");
  assert.equal(DEFAULT_INLINE_MODEL, "qwen3.7-plus");
  assert.equal(DEFAULT_INLINE_DEBOUNCE_MS, 300);
  assert.equal(DEFAULT_INLINE_TIMEOUT_MS, 3_000);
  assert.equal(DEFAULT_INLINE_MAX_TOKENS, 128);
  assert.equal(DEFAULT_INLINE_PREFIX_LINES, 10);
  assert.equal(DEFAULT_INLINE_SUFFIX_CHARS, 300);
  assert.equal(DEFAULT_INLINE_SUGGESTIONS_CHAT_INPUT, false);
});

test("parses the inline gateway defensively", () => {
  assert.equal(parseInlineGateway("zen"), "zen");
  assert.equal(parseInlineGateway("go"), "go");
  assert.equal(parseInlineGateway(undefined), "go");
  assert.equal(parseInlineGateway("enterprise"), "go");
  assert.equal(parseInlineGateway(42), "go");
});

test("clamps numeric settings into their allowed ranges", () => {
  assert.equal(clampNumber(150.9, 300, 0, 5_000), 150);
  assert.equal(clampNumber(9_999, 300, 0, 5_000), 5_000);
  assert.equal(clampNumber(-5, 300, 0, 5_000), 0);
  assert.equal(clampNumber(undefined, 300, 0, 5_000), 300);
  assert.equal(clampNumber("fast", 300, 0, 5_000), 300);
  assert.equal(clampNumber(Number.NaN, 300, 0, 5_000), 300);
  assert.equal(clampNumber(Number.POSITIVE_INFINITY, 300, 0, 5_000), 300);
});
