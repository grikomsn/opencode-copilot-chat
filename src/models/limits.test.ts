import assert from "node:assert/strict";
import test from "node:test";
import type { OpenCodeModel } from "./catalog";
import { advertisedModelLimits, requestOutputLimit } from "./limits";

const model: OpenCodeModel = {
  id: "model",
  rawModelId: "model",
  providerId: "opencode",
  name: "Model",
  family: "model",
  contextLength: 100_000,
  maxInputTokens: 90_000,
  maxOutputTokens: 32_000,
  reasoning: false,
  imageInput: false,
  toolCalling: true,
  endpoint: "chat-completions",
  baseUrl: "https://example.test/v1",
};

test("advertises input and output limits that fit within the context window", () => {
  assert.deepEqual(advertisedModelLimits(model), { maxInputTokens: 90_000, maxOutputTokens: 8_192 });
  assert.deepEqual(advertisedModelLimits({ ...model, maxInputTokens: undefined, contextLength: 8_000 }), {
    maxInputTokens: 1,
    maxOutputTokens: 7_999,
  });
});

test("caps request output using the prompt estimate and tokenizer headroom", () => {
  assert.equal(requestOutputLimit(model, 0, 80_000), 10_400);
  assert.equal(requestOutputLimit(model, 4_096, 80_000), 4_096);
  assert.equal(requestOutputLimit({ ...model, contextLength: 1_000 }, 0, 999), 1);
});
