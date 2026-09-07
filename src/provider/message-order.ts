import type { ChatMessage } from "./messages";

/** Tool results must immediately follow their assistant calls, before new user text. */
export function orderToolResults(current: ChatMessage, results: readonly ChatMessage[]): ChatMessage[] {
  if (!results.length) return [current];
  const hasContent = current.content.length > 0;
  return [...results, ...(hasContent || current.tool_calls?.length ? [current] : [])];
}
