const assert = require("node:assert/strict");
const vscode = require("vscode");
const { OpenCodeProvider } = require("../../out/provider");
const { readJournal } = require("../../out/provider-journal");

async function run() {
  const source = new vscode.CancellationTokenSource();
  const values = new Map();
  const journal = { get: (key) => values.get(key), update: async (key, value) => { await new Promise((resolve) => setImmediate(resolve)); values.set(key, value); } };
  const model = { id: "native-probe", rawModelId: "native-probe", providerId: "probe", name: "Native probe", family: "glm",
    contextLength: 10000, maxOutputTokens: 1000, reasoning: true, imageInput: false, toolCalling: true, endpoint: "chat-completions", baseUrl: "https://example.invalid/v1" };
  const factory = () => ({ isFresh: () => true, list: () => [model], get: () => model });
  const provider = new OpenCodeProvider({ getCredential: async () => undefined }, { appendLine() {} }, "native-test", "go", factory, {}, "default", journal);
  const prepare = async (entryId, apiKey, name = "Same display name") => (await provider.provideLanguageModelChatInformation({
    silent: true, configuration: { entryId, apiKey, name },
  }, source.token))[0];
  const [first, second] = await Promise.all([prepare("work", "synthetic-work"), prepare("personal", "synthetic-personal")]);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.credentialRef, second.credentialRef);
  assert.equal(Object.keys(readJournal(journal)).length, 2);
  const fetcher = globalThis.fetch;
  const headers = [];
  globalThis.fetch = async (_url, init) => {
    headers.push(new Headers(init.headers).get("Authorization"));
    return new Response([
      { choices: [{ delta: { reasoning_content: "synthetic plan" } }] },
      { choices: [{ delta: { tool_calls: [0, 1, 2].map((index) => ({ index, id: `call-${index}`, function: { name: "probe", arguments: JSON.stringify({ value: index }) } })) } }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n");
  };
  try {
    for (const [information, key] of [[first, "synthetic-work"], [second, "synthetic-personal"]]) {
      const output = [];
      await provider.provideLanguageModelChatResponse(information, [vscode.LanguageModelChatMessage.User("synthetic prompt")],
        { requestInitiator: "native-test", tools: [{ name: "probe", description: "Synthetic probe", inputSchema: { type: "object" } }] }, { report: (part) => output.push(part) }, source.token);
      assert.equal(headers.at(-1), `Bearer ${key}`);
      const calls = output.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
      assert.equal(calls.length, 3);
      assert.equal(new Set(calls.map((call) => call.callId)).size, 3);
      assert.equal(output[1].metadata.vscode_reasoning_done, true);
    }
    const rotated = await prepare("work", "synthetic-rotated", "Changed display name");
    assert.equal(first.id, rotated.id);
    assert.notEqual(first.credentialRef, rotated.credentialRef);
    await assert.rejects(provider.provideLanguageModelChatResponse(first, [], { requestInitiator: "native-test" }, { report() {} }, source.token), /replaced or removed/);
    await provider.provideLanguageModelChatResponse(rotated, [vscode.LanguageModelChatMessage.User("synthetic prompt")], { requestInitiator: "native-test" }, { report() {} }, source.token);
    assert.equal(headers.at(-1), "Bearer synthetic-rotated");
    const shared = await prepare("shared", "synthetic-personal");
    assert.notEqual(second.id, shared.id);
    assert.equal(second.credentialRef, shared.credentialRef);
    assert.equal((await provider.provideLanguageModelChatInformation({ silent: true, configuration: { name: "A B", apiKey: "synthetic" } }, source.token)).length, 0);
  } finally { globalThis.fetch = fetcher; source.dispose(); }
  console.log(JSON.stringify({ provider: "opencode", nativeChecks: "parallel tools, two entries, name independence, rotation, stale handles, shared key, concurrent journal", passed: true }));
}
module.exports = { run };
