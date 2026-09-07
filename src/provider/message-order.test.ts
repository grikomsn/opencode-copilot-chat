import assert from "node:assert/strict";
import test from "node:test";
import { orderToolResults } from "./message-order";
import type { ChatMessage } from "./messages";

const result: ChatMessage = { role: "tool", tool_call_id: "read-1", content: "fixture contents" };

test("does not insert an empty user message before a tool result", () => {
  assert.deepEqual(orderToolResults({ role: "user", content: "" }, [result]), [result]);
  assert.deepEqual(orderToolResults({ role: "user", content: [] }, [result]), [result]);
});

test("keeps parallel tool results together before accompanying user text", () => {
  const second: ChatMessage = { role: "tool", tool_call_id: "read-2", content: "second fixture" };
  const user: ChatMessage = { role: "user", content: "Now summarize both files" };
  assert.deepEqual(orderToolResults(user, [result, second]), [result, second, user]);
});

test("preserves normal messages when no tool result is present", () => {
  const message: ChatMessage = { role: "user", content: "Hello" };
  assert.deepEqual(orderToolResults(message, []), [message]);
});
