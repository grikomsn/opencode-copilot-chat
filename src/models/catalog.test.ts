import assert from "node:assert/strict";
import test from "node:test";
import { catalogScope, ModelCatalog, modelsFromProvider } from "./catalog";

test("filters deprecated and paid Console models when free-only is enabled", () => {
  const models = modelsFromProvider("console", "opencode", { api: "https://example.test/v1" }, {
    free: { id: "free", name: "Free", limit: { context: 100, output: 50 }, reasoning: true, tool_call: true, cost: { input: 0 } },
    paid: { id: "paid", limit: { context: 100, output: 50 }, cost: { input: 1 } },
    old: { id: "old", status: "deprecated", limit: { context: 100, output: 50 } },
  }, true);
  assert.deepEqual(models.map((model) => model.id), ["free"]);
});

test("filters internal smoke-test ids leaked into discovery", () => {
  const models = modelsFromProvider("console", "opencode", { api: "https://example.test/v1" }, {
    test: { id: "test" },
    "test-novita-dsf4.1": { id: "test-novita-dsf4.1" },
    "test-model": { id: "test-model" },
    tester: { id: "tester", name: "Tester" },
  }, false);
  assert.deepEqual(models.map((model) => model.id), ["tester"]);
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
  const models = await catalog.refresh("console", { mode: "console", token: "token" }, false);
  assert.deepEqual(models.map((model) => model.id), ["live"]);
  assert.deepEqual({ name: models[0].name, context: models[0].contextLength, output: models[0].maxOutputTokens, tools: models[0].toolCalling }, {
    name: "Live Name",
    context: 1000,
    output: 75,
    tools: false,
  });
});

test("uses the live public catalog without credentials and excludes stale metadata-only models", async () => {
  let authorization: string | null | undefined;
  const catalog = new ModelCatalog(async (input, init) => {
    if (String(input).endsWith("/models")) {
      authorization = new Headers(init?.headers).get("authorization");
      return Response.json({ data: [{ id: "current" }] });
    }
    return Response.json({ opencode: { models: {
      current: { id: "current", name: "Current", limit: { context: 1000 }, tool_call: true },
      removed: { id: "removed", name: "Removed" },
    } } });
  });
  const models = await catalog.refresh("console", undefined, false);
  assert.deepEqual(models.map((model) => model.id), ["current"]);
  assert.equal(models[0].name, "Current");
  assert.equal(authorization, null);
});

test("enriches discovery-only Go models with supplemental metadata", async () => {
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? Response.json({ data: [{ id: "hy3-preview" }, { id: "hy3" }] })
    : Response.json({ "opencode-go": { id: "opencode-go", models: {
      hy3: { id: "hy3", name: "Hy3", limit: { context: 256_000 }, reasoning: true, tool_call: true },
    } } }));
  const models = await catalog.refresh("go", { mode: "go", token: "token" }, false);
  assert.deepEqual(models.map((model) => model.id), ["hy3-preview", "hy3"]);
  const preview = models.find((model) => model.id === "hy3-preview");
  assert.deepEqual({ name: preview?.name, family: preview?.family, context: preview?.contextLength, reasoning: preview?.reasoning, tools: preview?.toolCalling }, {
    name: "Hy3 preview",
    family: "Hy",
    context: 256_000,
    reasoning: true,
    tools: true,
  });
  assert.equal(preview?.endpoint, "chat-completions");
  assert.equal(preview?.cost, undefined);
});

test("enriches discovery-only Go models with mirrored supplemental metadata", async () => {
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? Response.json({ data: [{ id: "deepseek-flash" }] })
    : Response.json({ "opencode-go": { id: "opencode-go", models: {} } }));
  const models = await catalog.refresh("go", { mode: "go", token: "token" }, false);
  assert.deepEqual(models.map((model) => model.id), ["deepseek-flash"]);
  const flash = models[0];
  assert.deepEqual({ name: flash.name, family: flash.family, context: flash.contextLength, output: flash.maxOutputTokens, image: flash.imageInput, reasoning: flash.reasoning, tools: flash.toolCalling, cost: flash.cost, endpoint: flash.endpoint }, {
    name: "DeepSeek V4.1 Flash",
    family: "deepseek-flash",
    context: 1_000_000,
    output: 384_000,
    image: true,
    reasoning: true,
    tools: true,
    cost: { input: 0.15, output: 0.6, cacheRead: 0.003 },
    endpoint: "chat-completions",
  });
});

test("hides a live alias id when its canonical model is also discovered", async () => {
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? Response.json({ data: [{ id: "deepseek-flash" }, { id: "deepseek-v4.1-flash" }] })
    : Response.json({ "opencode-go": { id: "opencode-go", models: {
      "deepseek-v4.1-flash": { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", limit: { context: 1_000_000, output: 384_000 }, reasoning: true, tool_call: true },
    } } }));
  const models = await catalog.refresh("go", { mode: "go", token: "token" }, false);
  assert.deepEqual(models.map((model) => model.id), ["deepseek-v4.1-flash"]);
  assert.equal(models[0].name, "DeepSeek V4.1 Flash");
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
  await new ModelCatalog(fetcher, cache).refresh("console", { mode: "console", token: "token" }, false);
  const catalog = new ModelCatalog(async () => new Response("no", { status: 503 }), cache);
  assert.deepEqual((await catalog.refreshSafely("console", { mode: "console", token: "token" }, false)).map((item) => item.id), ["cached"]);
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

test("excludes other Console-managed providers such as opencode-go from the Console group", async () => {
  const catalog = new ModelCatalog(async () => new Response(JSON.stringify({ config: { provider: {
    opencode: { models: { "glm-5.3": { id: "glm-5.3", name: "GLM-5.3", limit: { context: 1000, output: 100 } } } },
    "opencode-go": { models: { "kimi-k3": { id: "kimi-k3", name: "Kimi K3", limit: { context: 1000, output: 100 } } } },
    openai: { models: { "gpt-5": { id: "gpt-5", name: "GPT-5", limit: { context: 1000, output: 100 } } } },
  } } })));
  const models = await catalog.refresh("console", { mode: "console", token: "token", server: "https://example.test", orgId: "org" }, false);
  assert.deepEqual(models.map((model) => model.id), ["glm-5.3"]);
  assert.equal(models[0].providerId, "opencode");
});

test("returns no Console models when the organization config omits the opencode provider", async () => {
  const catalog = new ModelCatalog(async () => new Response(JSON.stringify({ config: { provider: {
    "opencode-go": { models: { "kimi-k3": { id: "kimi-k3", limit: { context: 1000, output: 100 } } } },
  } } })));
  await assert.rejects(
    () => catalog.refresh("console", { mode: "console", token: "token", server: "https://example.test", orgId: "org" }, false),
    /no usable models/,
  );
  assert.deepEqual(catalog.list("console"), []);
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
  const first = { mode: "console" as const, token: "first" };
  const second = { mode: "console" as const, token: "second" };
  const catalog = new ModelCatalog(async (input) => String(input).endsWith("/models")
    ? Response.json({ data: [{ id: "live" }] })
    : Response.json({ opencode: { models: { live: { id: "live" } } } }));
  await catalog.refresh("console", first, false);
  assert.equal(catalog.isFresh("console", 60_000, catalogScope("console", first, false)), true);
  assert.equal(catalog.isFresh("console", 60_000, catalogScope("console", second, false)), false);
});
