import assert from "node:assert/strict";
import test from "node:test";
import {
  MODELS_DEV_API_URL,
  MODELS_DEV_CACHE_KEY,
  MODELS_DEV_CACHE_TTL_MS,
  ModelsDevMetadata,
  normalizeModelsDevSnapshot,
  parseCachedModelsDevSnapshot,
  type MetadataCache,
} from "./metadata";

class MemoryCache implements MetadataCache {
  readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

const payload = {
  opencode: { id: "opencode", models: { free: { reasoning: true, tool_call: true, limit: { context: 1000, output: 100 }, cost: { input: 0 } } } },
  "opencode-go": { id: "opencode-go", models: { paid: { reasoning: true, modalities: { input: ["text", "image"] }, limit: { context: 2000, output: 200 } } } },
};

test("normalizes Zen and Go models.dev providers", () => {
  const snapshot = normalizeModelsDevSnapshot(payload, 123);
  assert.equal(snapshot.providers.opencode?.models?.free.limit?.context, 1000);
  assert.deepEqual(snapshot.providers["opencode-go"]?.models?.paid.modalities?.input, ["text", "image"]);
  assert.equal(parseCachedModelsDevSnapshot(snapshot)?.providers.opencode?.models?.free.tool_call, true);
  assert.equal(parseCachedModelsDevSnapshot({ fetchedAt: -1, providers: {} }), undefined);
});

test("persists, reuses, and refreshes a shared models.dev snapshot", async () => {
  const cache = new MemoryCache();
  let now = 1000;
  let calls = 0;
  const metadata = new ModelsDevMetadata(cache, async (input) => {
    calls += 1;
    assert.equal(String(input), MODELS_DEV_API_URL);
    return Response.json(payload);
  }, () => now);
  const first = await metadata.getOrRefresh();
  assert.equal(await metadata.getOrRefresh(), first);
  assert.equal(calls, 1);
  assert.deepEqual(cache.values.get(MODELS_DEV_CACHE_KEY), first);
  now += MODELS_DEV_CACHE_TTL_MS + 1;
  assert.equal(await metadata.getOrRefresh(), first);
  assert.equal(calls, 2);
});

test("falls back to stale persisted metadata when refresh fails", async () => {
  const cache = new MemoryCache();
  cache.values.set(MODELS_DEV_CACHE_KEY, normalizeModelsDevSnapshot(payload, 1));
  const metadata = new ModelsDevMetadata(cache, async () => new Response("unavailable", { status: 503 }), () => 999999);
  assert.ok((await metadata.refresh()).providers.opencode?.models?.free);
});
