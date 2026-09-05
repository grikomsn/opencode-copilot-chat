/**
 * Prompt construction for the chat-completions completion engine.
 *
 * The gateway has no dedicated FIM endpoint, so fill-in-the-middle is emulated
 * with FIM delimiter tokens inline in a single user message. Families with a
 * genuine non-thinking mode (live-measured zero hidden reasoning, ~1.4s TTFB
 * on qwen3.7-plus) send an explicit thinking-off field; reasoning-first
 * families are deliberately given no special field and are not recommended
 * for inline completions.
 *
 * Pure and unit-tested.
 */

export interface CompletionPrompt {
  readonly messages: ReadonlyArray<{ role: string; content: string }>;
  /** Extra body fields the gateway needs for this family (e.g. enable_thinking). */
  readonly extra: Readonly<Record<string, unknown>>;
}

export const COMPLETION_SYSTEM_PROMPT = "Return only the missing code at the cursor. No explanations, no markdown.";

export type CompletionFamily = "qwen" | "kimi" | "unknown";

export function completionFamily(modelId: string): CompletionFamily {
  const id = modelId.toLowerCase().split("/").at(-1) ?? modelId.toLowerCase();
  if (id.startsWith("qwen")) return "qwen";
  if (id.startsWith("kimi")) return "kimi";
  return "unknown";
}

/** FIM delimiter tokens. Qwen and Kimi code models recognize this sequence. */
export function fimTokens(): { prefix: string; suffix: string; middle: string } {
  return { prefix: "<|fim_prefix|>", suffix: "<|fim_suffix|>", middle: "<|fim_middle|>" };
}

export function buildCompletionPrompt(prefix: string, suffix: string, modelId: string): CompletionPrompt {
  const tokens = fimTokens();
  const userContent = `${tokens.prefix}${prefix}${tokens.suffix}${suffix}${tokens.middle}`;
  const family = completionFamily(modelId);
  const extra: Record<string, unknown> = {};
  if (family === "qwen") {
    // Qwen3 hybrid: enable_thinking=false is a genuine no-reasoning mode
    // (live-measured zero hidden reasoning).
    extra.enable_thinking = false;
  } else if (family === "kimi") {
    // Kimi accepts an explicit thinking toggle over chat completions
    // (live-measured zero hidden reasoning on kimi-k2.6).
    extra.thinking = { type: "disabled" };
  }
  return {
    messages: [
      { role: "system", content: COMPLETION_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    extra,
  };
}