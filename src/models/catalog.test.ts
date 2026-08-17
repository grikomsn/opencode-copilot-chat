import assert from "node:assert/strict";
import test from "node:test";
import { catalogScope, ModelCatalog, modelsFromProvider } from "./catalog";

test("filters deprecated and paid Zen models when free-only is enabled", () => {
  const models = modelsFromProvider("zen", "opencode", { api: "https://example.test/v1" }, {
    free: { id: "free", name: "Free", limit: { context: 100, output: 50 }, reasoning: true, tool_call: true, cost: { input: 0 } },
    paid: { id: "paid", limit: { context: 100, output: 50 }, cost: { input: 1 } },
    old: { id: "old", status: "deprecated", limit: { context: 100, output: 50 } },
  }, true);
  assert.deepEqual(models.map((model) => model.id), ["free"]);
});

test("preserves live reasoning options for the per-model thinking picker", () => {
  const [model] = modelsFromProvider("go", "opencode-go", {}, {
    "qwen3.7-max": {
      reasoning: true,
      reasoning_options: [{ type: "toggle" }, { type: "budget_tokens", max: 262_144 }],
    },
  }, false);
  assert.deepEqual(model.reasoningOptions, [{ type: "toggle" }, { type: "budget_tokens", max: 262_144 }]);
});

test("uses explicit modalities for image capability and preserves input limits", () => {
  const models = modelsFromProvider("go", "opencode-go", {}, {
    text: { attachment: true, modalities: { input: ["text"] }, limit: { context: 1000, input: 800 } },
    legacy: { attachment: true, limit: { context: 1000 } },
  }, false);
  assert.equal(models[0].imageInput, false);
  assert.equal(models[0].maxInputTokens, 800);
  assert.equal(models[1].imageInput, true);
});

test("uses authenticated live models and enriches fields from models.dev", async () => {
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? new Response(JSON.stringify({ data: [{ id: "live", name: "Live Name", limit: { output: 75 }, tool_call: false }] }))
    : new Response(JSON.stringify({ opencode: { models: {
      live: { id: "live", name: "Metadata Name", limit: { context: 1000, output: 50 }, reasoning: true, tool_call: true },
      stale: { id: "stale" },
    } } })));
  const models = await catalog.refresh("zen", { mode: "zen", token: "token" }, false);
  assert.deepEqual(models.map((model) => model.id), ["live"]);
  assert.deepEqual({ name: models[0].name, context: models[0].contextLength, output: models[0].maxOutputTokens, tools: models[0].toolCalling }, {
    name: "Live Name",
    context: 1000,
    output: 75,
    tools: false,
  });
});

test("restores a recent authenticated catalog cache when refresh fails", async () => {
  const values = new Map<string, unknown>();
  const cache = {
    get<T>(key: string): T | undefined { return values.get(key) as T | undefined; },
    async update(key: string, value: unknown): Promise<void> { values.set(key, value); },
  };
  const fetcher = async (input: RequestInfo | URL) => String(input).endsWith("/models")
    ? new Response(JSON.stringify({ data: [{ id: "cached" }] }))
    : new Response(JSON.stringify({ opencode: { models: { cached: { id: "cached" } } } }));
  await new ModelCatalog(fetcher, cache).refresh("zen", { mode: "zen", token: "token" }, false);
  const catalog = new ModelCatalog(async () => new Response("no", { status: 503 }), cache);
  assert.deepEqual((await catalog.refreshSafely("zen", { mode: "zen", token: "token" }, false)).map((item) => item.id), ["cached"]);
});

test("resolves Console models from the organization configuration", async () => {
  let requestedHeaders: Headers | undefined;
  const catalog = new ModelCatalog(async (_input, init) => {
    requestedHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({ config: { provider: {
    opencode: { api: "https://example.test/v1", models: { allowed: { id: "allowed", name: "Allowed", limit: { context: 1000, output: 100 }, tool_call: true }, disabled: { id: "disabled", name: "Disabled", disabled: true, limit: { context: 1000, output: 100 } } } },
  } } }));
  });
  const models = await catalog.refresh("console", { mode: "console", token: "token", server: "https://example.test", orgId: "org" }, false);
  assert.deepEqual(models.map((model) => model.id), ["allowed"]);
  assert.equal(models[0].providerId, "opencode");
  assert.equal(requestedHeaders?.get("x-org-id"), "org");
});

test("never falls back to a public model list for Console", async () => {
  const catalog = new ModelCatalog(async () => new Response("unavailable", { status: 503 }));
  assert.deepEqual(catalog.list("console"), []);
  assert.deepEqual(await catalog.refreshSafely("console", { mode: "console", token: "token", server: "https://example.test", orgId: "org" }, false), []);
  assert.deepEqual(catalog.list("console"), []);
});

test("invalidates a fresh Console catalog when the active organization changes", async () => {
  const credential = { mode: "console" as const, token: "token", server: "https://example.test", orgId: "org-a" };
  const catalog = new ModelCatalog(async () => new Response(JSON.stringify({ config: { provider: {
    opencode: { models: { allowed: { id: "allowed", limit: { context: 100, output: 50 } } } },
  } } })));
  await catalog.refresh("console", credential, false);
  assert.equal(catalog.isFresh("console", 60_000, catalogScope("console", credential, false)), true);
  assert.equal(catalog.isFresh("console", 60_000, catalogScope("console", { ...credential, orgId: "org-b" }, false)), false);
});

test("invalidates a fresh public catalog when the authenticated account changes", async () => {
  const first = { mode: "zen" as const, token: "first" };
  const second = { mode: "zen" as const, token: "second" };
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? Response.json({ data: [{ id: "live" }] })
    : Response.json({ opencode: { models: { live: { id: "live" } } } }));
  await catalog.refresh("zen", first, false);
  assert.equal(catalog.isFresh("zen", 60_000, catalogScope("zen", first, false)), true);
  assert.equal(catalog.isFresh("zen", 60_000, catalogScope("zen", second, false)), false);
});
