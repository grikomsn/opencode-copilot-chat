import assert from "node:assert/strict";
import test from "node:test";
import type { OpenCodeModel } from "./catalog";
import { modelConfigurationSchema, requestModelConfiguration, resolveThinkingSelection, thinkingPayload } from "./options";

// VS Code 1.141 reads reasoningEffort, then filters through its agent-host tiers.
const SDK_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const model: OpenCodeModel = {
  id: "gpt-5.6-sol", rawModelId: "gpt-5.6-sol", providerId: "opencode", name: "GPT-5.6 Sol", family: "gpt",
  contextLength: 244_800, maxOutputTokens: 8_192, reasoning: true,
  reasoningOptions: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
  imageInput: false, toolCalling: true, endpoint: "responses", baseUrl: "https://example.test/v1",
};

test("Copilot SDK BYOK discovers effort tiers while preserving native toggle and budget controls", () => {
  const qwen: OpenCodeModel = {
    ...model, rawModelId: "qwen3.7-max", family: "qwen", endpoint: "chat-completions",
    reasoningOptions: [{ type: "toggle" }, { type: "budget_tokens", max: 262_144 }],
  };
  for (const candidate of [model, qwen]) {
    for (const contextLength of [32_768, 244_800]) {
      const schema = modelConfigurationSchema({ ...candidate, contextLength });
      const effortSchema = schema?.properties?.reasoningEffort;
      assert.ok(effortSchema, "BYOK requires reasoningEffort");
      const bridged = (effortSchema.enum as unknown[]).filter((value): value is string => typeof value === "string");
      assert.deepEqual(bridged, candidate === model ? ["off", "low", "medium", "high", "xhigh", "max"] : ["off", "auto", "on"]);
      assert.ok(bridged.includes(String(effortSchema.default)));
      assert.deepEqual(bridged.filter((effort) => SDK_EFFORTS.has(effort)), candidate === model ? ["low", "medium", "high", "xhigh", "max"] : []);
    }
  }
  const plain = { ...model, rawModelId: "plain", family: "plain", reasoning: false, reasoningOptions: undefined };
  assert.equal(modelConfigurationSchema(plain)?.properties?.reasoningEffort, undefined);
});

test("Copilot SDK effort selections reach OpenCode endpoint-native request fields", () => {
  const schema = modelConfigurationSchema(model);
  const bridged = (schema?.properties?.reasoningEffort.enum as unknown[]).filter((value): value is string => typeof value === "string");
  for (const effort of bridged.filter((value) => SDK_EFFORTS.has(value))) {
    const configuration = requestModelConfiguration({ modelConfiguration: { reasoningEffort: effort } });
    const selected = resolveThinkingSelection(model, configuration, "low");
    assert.deepEqual(selected, { effort });
    assert.deepEqual(thinkingPayload(model, selected), { reasoning: { effort } });
    assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions" }, selected), { reasoning_effort: effort });
  }
  // Local chat retains the native toggle and workspace budget fallback.
  const qwen: OpenCodeModel = { ...model, rawModelId: "qwen3.7-max", family: "qwen", endpoint: "chat-completions", reasoningOptions: [{ type: "toggle" }, { type: "budget_tokens", max: 262_144 }] };
  const native = resolveThinkingSelection(qwen, { reasoningEffort: "on" }, "off", "16384");
  assert.deepEqual(thinkingPayload(qwen, native), { enable_thinking: true, thinking_budget: 16_384 });
});
