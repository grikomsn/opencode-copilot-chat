import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_INLINE_GATEWAY, DEFAULT_INLINE_MODEL } from "./config";
import { inlineModelChoicesForGateway, INLINE_MODEL_CANDIDATES } from "./models";

test("both gateways expose candidates with the recommended default first", () => {
  for (const gateway of ["go", "zen"] as const) {
    const candidates = INLINE_MODEL_CANDIDATES[gateway];
    assert.ok(candidates.length >= 2, `${gateway} should list alternatives`);
    assert.equal(candidates[0]?.badge.includes("★ recommended"), true, `${gateway} should lead with a recommendation`);
  }
  assert.equal(INLINE_MODEL_CANDIDATES.go[0]?.id, DEFAULT_INLINE_MODEL);
});

test("default gateway candidate matches the configured default gateway", () => {
  assert.equal(INLINE_MODEL_CANDIDATES[DEFAULT_INLINE_GATEWAY][0]?.id, "qwen3.7-plus");
  assert.equal(INLINE_MODEL_CANDIDATES.zen[0]?.id, "qwen3.6-plus");
});

test("every candidate carries a badge and a rationale", () => {
  for (const candidates of Object.values(INLINE_MODEL_CANDIDATES)) {
    for (const candidate of candidates) {
      assert.ok(candidate.badge.length > 0);
      assert.ok(candidate.detail.length > 0);
    }
  }
});

test("candidate ids are unique within a gateway", () => {
  for (const candidates of Object.values(INLINE_MODEL_CANDIDATES)) {
    assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, candidates.length);
  }
});

test("pins an unlisted current value above the vetted list", () => {
  const choices = inlineModelChoicesForGateway("go", "some-custom-model");
  assert.equal(choices[0]?.id, "some-custom-model");
  assert.equal(choices[0]?.description, "current value");
  assert.equal(choices[1]?.id, "qwen3.7-plus");
});

test("marks the current value with a check without pinning duplicates", () => {
  const choices = inlineModelChoicesForGateway("go", "qwen3.7-plus");
  assert.equal(choices[0]?.label, "$(check) qwen3.7-plus");
  assert.equal(choices.filter((choice) => choice.id === "qwen3.7-plus").length, 1);
});
