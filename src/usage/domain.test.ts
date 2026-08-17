import assert from "node:assert/strict";
import test from "node:test";
import { recordRequestUsage, usageFromPayload } from "./domain";

test("parses provider token fields and derives total usage", () => {
  const snapshot = usageFromPayload({ prompt_tokens: 120, completion_tokens: 30 }, "gpt-5.6-sol");
  assert.equal(snapshot.model, "gpt-5.6-sol");
  assert.equal(snapshot.inputTokens, 120);
  assert.equal(snapshot.outputTokens, 30);
  assert.equal(snapshot.totalTokens, 150);
  assert.equal(typeof snapshot.updatedAt, "number");
});

test("accepts alternate OpenCode token field names and preserves explicit totals", () => {
  const snapshot = usageFromPayload({ input_tokens: 4, candidatesTokenCount: 6, totalTokenCount: 99 }, "claude-sonnet-5");
  assert.deepEqual({ inputTokens: snapshot.inputTokens, outputTokens: snapshot.outputTokens, totalTokens: snapshot.totalTokens }, {
    inputTokens: 4,
    outputTokens: 6,
    totalTokens: 99,
  });
});

test("ignores malformed usage values", () => {
  const snapshot = usageFromPayload({ prompt_tokens: "120", completion_tokens: null }, "unknown");
  assert.equal(snapshot.inputTokens, undefined);
  assert.equal(snapshot.outputTokens, undefined);
  assert.equal(snapshot.totalTokens, undefined);
});

test("accumulates request usage across provider groups", () => {
  const first = recordRequestUsage({}, usageFromPayload({ prompt_tokens: 10, completion_tokens: 5 }, "zen-model", 100));
  const second = recordRequestUsage(first, usageFromPayload({ input_tokens: 7, output_tokens: 3 }, "go-model", 200));
  assert.deepEqual(second.tracked, { requests: 2, inputTokens: 17, outputTokens: 8, totalTokens: 25 });
  assert.equal(second.model, "go-model");
  assert.equal(second.updatedAt, 200);
});
