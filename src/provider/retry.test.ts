import assert from "node:assert/strict";
import test from "node:test";
import { analyzeHttp400ForRetry, isTransientServerError, retryDelayMs } from "./retry";

test("removes provider-specific fields rejected by an upstream model", () => {
  assert.deepEqual(
    analyzeHttp400ForRetry("Extra inputs are not permitted, field: 'reasoning_effort'", { reasoning_effort: "high", model: "m" }),
    { body: { model: "m" }, reason: "removed rejected reasoning_effort" },
  );
});

test("reduces output after an authoritative context overflow response", () => {
  const patch = analyzeHttp400ForRetry(
    "maximum context length is 100,000 tokens; you requested 110,000 tokens, 20,000 in the completion",
    { max_tokens: 20_000 },
  );
  assert.deepEqual(patch, { body: { max_tokens: 9_744 }, reason: "reduced output limit from 20000 to 9744" });
});

test("retries only known transient server failures with bounded backoff", () => {
  assert.equal(isTransientServerError(503, "unavailable"), true);
  assert.equal(isTransientServerError(500, "Router.Unavailable"), true);
  assert.equal(isTransientServerError(500, "Internal server error"), true);
  assert.equal(isTransientServerError(500, "permanent failure"), false);
  assert.deepEqual([0, 1, 2, 8].map(retryDelayMs), [250, 500, 1_000, 2_000]);
});
