import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionWindow, isChatInputDocument, isCompletionDocument } from "./context";

test("keeps exactly prefixLines full lines above the cursor", () => {
  const text = "l1\nl2\nl3|cursor";
  const offset = text.indexOf("|");
  const window = buildCompletionWindow(text.replace("|", ""), offset, { prefixLines: 2, suffixChars: 0 });
  assert.equal(window.prefix, "l1\nl2\nl3");
  assert.equal(window.suffix, "");
});

test("drops lines beyond the prefix budget", () => {
  const text = "x\nl1\nl2\nl3|";
  const offset = text.indexOf("|");
  const window = buildCompletionWindow(text.replace("|", ""), offset, { prefixLines: 2, suffixChars: 0 });
  assert.equal(window.prefix, "l1\nl2\nl3");
});

test("keeps the cursor line and a bounded suffix", () => {
  const text = "ab|cd";
  const offset = text.indexOf("|");
  const window = buildCompletionWindow(text.replace("|", ""), offset, { prefixLines: 0, suffixChars: 1 });
  assert.equal(window.prefix, "ab");
  assert.equal(window.suffix, "c");
});

test("clamps offsets outside the document", () => {
  const window = buildCompletionWindow("abc", 99, { prefixLines: 1, suffixChars: 0 });
  assert.equal(window.prefix, "abc");
});

test("classifies chat input and code documents", () => {
  assert.equal(isChatInputDocument({ scheme: "chatSessionInput" }), true);
  assert.equal(isChatInputDocument({ scheme: "sessions-chat" }), true);
  assert.equal(isCompletionDocument({ scheme: "file" }), true);
  assert.equal(isCompletionDocument({ scheme: "untitled" }), true);
  assert.equal(isCompletionDocument({ scheme: "chatSessionInput" }), false);
  assert.equal(isCompletionDocument({ scheme: "output" }), false);
});