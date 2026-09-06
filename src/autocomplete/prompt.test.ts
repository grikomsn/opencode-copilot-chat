import assert from "node:assert/strict";
import test from "node:test";
import { buildCompletionPrompt, COMPLETION_SYSTEM_PROMPT, completionFamily, stripSpecialTokens } from "./prompt";

test("emulates fill-in-the-middle with FIM tokens", () => {
  const prompt = buildCompletionPrompt("before", "after", "qwen3.7-plus");
  assert.equal(prompt.messages[0]?.content, COMPLETION_SYSTEM_PROMPT);
  assert.equal(
    prompt.messages[1]?.content,
    "<|fim_prefix|>before<|fim_suffix|>after<|fim_middle|>",
  );
});

test("qwen models send an explicit enable_thinking=false", () => {
  const prompt = buildCompletionPrompt("a", "b", "qwen3.6-plus");
  assert.deepEqual(prompt.extra, { enable_thinking: false });
});

test("kimi models send a disabled thinking toggle", () => {
  const prompt = buildCompletionPrompt("a", "b", "kimi-k2.6");
  assert.deepEqual(prompt.extra, { thinking: { type: "disabled" } });
});

test("unknown families send no thinking field", () => {
  assert.deepEqual(buildCompletionPrompt("a", "b", "glm-5.2").extra, {});
});

test("maps model ids to families, ignoring provider prefixes", () => {
  assert.equal(completionFamily("alibaba/qwen3.7-max"), "qwen");
  assert.equal(completionFamily("moonshot/kimi-k2.6"), "kimi");
  assert.equal(completionFamily("glm-5.3"), "unknown");
});

test("strips echoed special tokens from suggestions", () => {
  assert.equal(stripSpecialTokens("<|file_separator|>    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("    out.append(x)<|fim_middle|>"), "    out.append(x)");
  assert.equal(stripSpecialTokens("<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>c"), "abc");
  assert.equal(stripSpecialTokens("    out.append(x)"), "    out.append(x)");
  assert.equal(stripSpecialTokens("echo <| b; # no closing pair"), "echo <| b; # no closing pair");
  assert.equal(stripSpecialTokens("<|file_separator|>"), "");
});
