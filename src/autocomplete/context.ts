/**
 * Completion context extraction: a bounded prefix/suffix window around the
 * cursor plus document eligibility checks.
 *
 * Window bounds keep request payloads tiny — inline completion must be fast.
 * Pure and unit-tested.
 */

export interface CompletionWindowOptions {
  readonly prefixLines: number;
  readonly suffixChars: number;
}

export interface CompletionWindow {
  readonly prefix: string;
  readonly suffix: string;
}

/**
 * VS Code exposes the Copilot Chat prompt box as a virtual editor document
 * with one of these schemes. Inline-completion providers registered on "**"
 * are asked for suggestions there too — ghost text must never appear while
 * the user is typing a prompt.
 */
export const CHAT_INPUT_SCHEMES = new Set(["chatSessionInput", "sessions-chat"]);

/** Schemes eligible for completions (real editable code surfaces). */
const COMPLETION_SCHEMES = new Set(["file", "untitled"]);

/** Whether a document is a chat/interactive prompt box (no completions there). */
export function isChatInputDocument(uri: { scheme: string }): boolean {
  return CHAT_INPUT_SCHEMES.has(uri.scheme);
}

/** Whether a document is an editable code surface eligible for suggestions. */
export function isCompletionDocument(uri: { scheme: string }): boolean {
  return COMPLETION_SCHEMES.has(uri.scheme);
}

/** Build the FIM prefix/suffix window around `offset` with bounded context. */
export function buildCompletionWindow(text: string, offset: number, options: CompletionWindowOptions): CompletionWindow {
  const boundedOffset = Math.min(Math.max(offset, 0), text.length);
  const linesBefore = Math.max(0, options.prefixLines);
  let start = boundedOffset;
  let newlines = 0;
  while (start > 0 && newlines <= linesBefore) {
    if (text.charCodeAt(start - 1) === 10) newlines += 1;
    start -= 1;
  }
  // The scan overshoots by one newline when the budget is exceeded; step
  // forward so the prefix keeps exactly `prefixLines` full lines above the
  // cursor line plus the cursor line itself.
  if (newlines > linesBefore) start += 1;
  const suffixChars = Math.max(0, options.suffixChars);
  const end = Math.min(text.length, boundedOffset + suffixChars);
  return { prefix: text.slice(start, boundedOffset), suffix: text.slice(boundedOffset, end) };
}