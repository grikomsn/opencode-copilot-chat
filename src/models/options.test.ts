import assert from "node:assert/strict";
import test from "node:test";
import type { OpenCodeModel } from "./catalog";
import { modelConfigurationSchema, requestModelConfiguration, resolveThinkingSelection, thinkingPayload } from "./options";

const model: OpenCodeModel = {
  id: "gpt-5.6-sol",
  rawModelId: "gpt-5.6-sol",
  providerId: "opencode",
  name: "GPT-5.6 Sol",
  family: "gpt",
  contextLength: 100_000,
  maxOutputTokens: 8_192,
  reasoning: true,
  reasoningOptions: [{ type: "effort", values: ["none", "low", "medium", "high", "xhigh", "max"] }],
  imageInput: false,
  toolCalling: true,
  endpoint: "responses",
  baseUrl: "https://example.test/v1",
};

test("exposes a native Thinking Effort navigation control from live model metadata", () => {
  const schema = modelConfigurationSchema(model);
  assert.deepEqual(schema?.properties?.reasoningEffort.enum, ["off", "low", "medium", "high", "xhigh", "max"]);
  assert.equal(schema?.properties?.reasoningEffort.title, "Thinking Effort");
  assert.equal(schema?.properties?.reasoningEffort.group, "navigation");
  assert.equal(schema?.properties?.reasoningEffort.default, "high");
  assert.deepEqual(schema?.properties?.reasoningEffort.enumItemLabels, ["Off", "Low", "Medium", "High", "Extra High", "Max"]);
  assert.equal(modelConfigurationSchema({ ...model, rawModelId: "plain-model", family: "plain", reasoningOptions: undefined, reasoning: false }), undefined);
});

test("uses a supported per-model selection and falls back to the model default", () => {
  assert.deepEqual(resolveThinkingSelection(model, { reasoningEffort: "xhigh" }, "low"), { effort: "xhigh" });
  assert.deepEqual(resolveThinkingSelection(model, { thinkingMode: "high" }, "low"), { effort: "high" });
  assert.deepEqual(resolveThinkingSelection(model, { reasoningEffort: "on", thinkingMode: "high" }, "low"), { effort: "high" });
  assert.deepEqual(resolveThinkingSelection(model, { reasoningEffort: "invalid" }, "max"), { effort: "max" });
  assert.equal(resolveThinkingSelection({ ...model, rawModelId: "plain-model", family: "plain", reasoningOptions: undefined, reasoning: false }, undefined, "high"), undefined);
});

test("exposes GPT thinking controls when Console metadata omits reasoning flags", () => {
  const consoleGpt = { ...model, rawModelId: "openai/gpt-5.6-sol", reasoning: false, reasoningOptions: undefined };
  const schema = modelConfigurationSchema(consoleGpt);
  assert.deepEqual(schema?.properties?.reasoningEffort.enum, ["off", "low", "medium", "high", "xhigh"]);
  assert.equal(schema?.properties?.reasoningEffort.group, "navigation");
  assert.equal(schema?.properties?.reasoningEffort.default, "high");
  assert.deepEqual(resolveThinkingSelection(consoleGpt, { reasoningEffort: "high" }, "off"), { effort: "high" });
  assert.deepEqual(thinkingPayload(consoleGpt, { effort: "high" }), { reasoning: { effort: "high" } });
});

test("accepts current and legacy VS Code request configuration fields", () => {
  assert.deepEqual(requestModelConfiguration({ modelConfiguration: { reasoningEffort: "high" }, configuration: { reasoningEffort: "low" } }), { reasoningEffort: "high" });
  assert.deepEqual(requestModelConfiguration({ configuration: { reasoningEffort: "low" } }), { reasoningEffort: "low" });
});

test("maps effort models to their endpoint-native payloads", () => {
  assert.deepEqual(thinkingPayload(model, { effort: "high" }), { reasoning: { effort: "high" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "deepseek-v4-flash" }, { effort: "max" }), { reasoning_effort: "max" });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "messages", rawModelId: "claude-opus-4-7" }, { effort: "high" }), { output_config: { effort: "high" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "google", rawModelId: "gemini-3.5-flash" }, { effort: "low" }), { thinkingConfig: { thinkingLevel: "low" } });
  assert.deepEqual(thinkingPayload(model, { effort: "off" }), {});
});

test("supports Qwen mode and token-budget controls on both transports", () => {
  const qwen = {
    ...model,
    rawModelId: "qwen3.7-max",
    family: "qwen",
    endpoint: "chat-completions" as const,
    reasoningOptions: [{ type: "toggle" }, { type: "budget_tokens", max: 262_144 }],
  };
  const schema = modelConfigurationSchema(qwen);
  assert.deepEqual(schema?.properties?.reasoningEffort.enum, ["off", "auto", "on"]);
  assert.equal(schema?.properties?.reasoningEffort.title, "Thinking");
  assert.equal(schema?.properties?.reasoningEffort.default, "auto");
  assert.equal(schema?.properties?.thinkingBudget.group, "tokens");
  assert.equal(schema?.properties?.thinkingBudget.default, "auto");
  assert.deepEqual(schema?.properties?.thinkingBudget.enum, ["auto", "4096", "16384", "32768", "81920"]);
  assert.deepEqual(schema?.properties?.thinkingBudget.enumItemLabels, ["Auto", "4K", "16K", "32K", "80K"]);
  assert.deepEqual(resolveThinkingSelection(qwen, { reasoningEffort: "on" }, "off", "auto"), { effort: "on" });
  assert.deepEqual(resolveThinkingSelection(qwen, { reasoningEffort: "on" }, "off", "16384"), { effort: "on", budget: 16_384 });
  assert.deepEqual(resolveThinkingSelection(qwen, { reasoningEffort: "on", thinkingBudget: "16384" }, "off"), { effort: "on", budget: 16_384 });
  assert.deepEqual(thinkingPayload(qwen, { effort: "on", budget: 16_384 }), { enable_thinking: true, thinking_budget: 16_384 });
  assert.deepEqual(thinkingPayload({ ...qwen, endpoint: "messages" }, { effort: "off" }), { thinking: { type: "disabled" } });
});

test("maps toggle families to their gateway-specific payloads", () => {
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "kimi-k2.6", family: "kimi" }, { effort: "off" }), { thinking: { type: "disabled" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "kimi-k2.7-code", family: "kimi" }, { effort: "off" }), { thinking: { type: "enabled", keep: "all" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "messages", rawModelId: "minimax-m2.7", family: "minimax" }, { effort: "on" }), { thinking: { type: "enabled" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "minimax-m3", family: "minimax" }, { effort: "on" }), { thinking: { type: "adaptive" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "minimax-m3", family: "minimax" }, { effort: "off" }), {});
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "glm-5", family: "glm" }, { effort: "off" }), { thinking: { type: "disabled" } });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "chat-completions", rawModelId: "mimo-v2.5", family: "mimo" }, { effort: "medium" }), { reasoning_effort: "medium", budget_tokens: 16_384 });
  assert.deepEqual(thinkingPayload({ ...model, endpoint: "messages", rawModelId: "moonshot/kimi-k2.7-code", family: "kimi" }, { effort: "off" }), { thinking: { type: "enabled", keep: "all" } });
  const kimiSchema = modelConfigurationSchema({ ...model, rawModelId: "moonshot/kimi-k2.7-code", family: "kimi", reasoningOptions: undefined });
  assert.deepEqual(kimiSchema?.properties?.reasoningEffort.enumItemLabels, ["Always On (K2.7)"]);
  const descriptions = kimiSchema?.properties?.reasoningEffort.enumDescriptions as string[] | undefined;
  assert.match(String(descriptions?.[0]), /requires thinking enabled/);
  assert.equal(modelConfigurationSchema({ ...model, rawModelId: "kimi-k2.6", family: "kimi", reasoningOptions: undefined })?.properties?.reasoningEffort.default, "on");
});

test("derives known-family controls when catalogs omit reasoning metadata", () => {
  const cases = [
    ["openai/gpt-5.6-sol", "gpt", ["off", "low", "medium", "high", "xhigh"]],
    ["deepseek/deepseek-v4-flash", "deepseek", ["off", "low", "medium", "high", "max"]],
    ["zai/glm-5", "glm", ["off", "high", "max"]],
    ["moonshot/kimi-k2.6", "kimi", ["off", "on"]],
    ["minimax/minimax-m3", "minimax", ["off", "on"]],
    ["xiaomi/mimo-v2.5", "mimo", ["off", "low", "medium", "high"]],
    ["alibaba/qwen3.7-max", "qwen", ["off", "auto", "on"]],
  ] as const;
  for (const [rawModelId, family, efforts] of cases) {
    const sparseModel = { ...model, rawModelId, family, reasoning: false, reasoningOptions: undefined };
    assert.deepEqual(modelConfigurationSchema(sparseModel)?.properties?.reasoningEffort.enum, efforts, rawModelId);
  }
});

test("exposes upstream-compatible generic controls without inventing payload fields", () => {
  const unknown = { ...model, rawModelId: "new-reasoner", family: "new", reasoningOptions: undefined, endpoint: "chat-completions" as const };
  assert.deepEqual(modelConfigurationSchema(unknown)?.properties?.reasoningEffort.enum, ["off", "on"]);
  assert.deepEqual(thinkingPayload(unknown, { effort: "on" }), {});
  const explicit = { ...unknown, reasoningOptions: [{ type: "toggle" }, { type: "effort", values: ["low", "high"] }] };
  assert.deepEqual(modelConfigurationSchema(explicit)?.properties?.reasoningEffort.enum, ["off", "on", "low", "high"]);
  assert.deepEqual(thinkingPayload(explicit, { effort: "high" }), {});
});
