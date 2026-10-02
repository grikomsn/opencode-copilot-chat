import type { ModelCost } from "./pricing";

export const MODELS_DEV_API_URL = "https://models.dev/api.json";
export const MODELS_DEV_CACHE_KEY = "opencode.modelsDevMetadata.v1";
export const MODELS_DEV_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MODELS_DEV_TIMEOUT_MS = 15_000;

export interface ReasoningOptionSource {
  type?: string;
  values?: string[];
  min?: number;
  max?: number;
}

export interface ModelSource {
  id?: string;
  name?: string;
  family?: string;
  limit?: { context?: number; input?: number; output?: number };
  reasoning?: boolean;
  reasoning_options?: ReasoningOptionSource[];
  tool_call?: boolean;
  attachment?: boolean;
  modalities?: { input?: string[] };
  status?: string;
  disabled?: boolean;
  cost?: Partial<ModelCost> & { cache_read?: number };
  provider?: { npm?: string; api?: string };
  options?: Record<string, unknown>;
}

export interface ProviderSource {
  id?: string;
  name?: string;
  api?: string;
  npm?: string;
  models?: Record<string, ModelSource>;
  options?: Record<string, unknown>;
}

export interface ModelsDevSnapshot {
  readonly fetchedAt: number;
  readonly providers: Readonly<Record<"opencode" | "opencode-go", ProviderSource | undefined>>;
}

// Models served by OpenCode discovery before models.dev catalogs them. Each
// entry mirrors the closest sibling model, is only used when models.dev lacks
// the id, and is superseded by the canonical entry once it lands upstream.
// Mirrors only carry data that a canonical upstream entry already publishes
// for the same model; nothing is guessed. `deepseek-flash` mirrors the
// DeepSeek provider entry, and the anonymous-discovery Go ids mirror their
// Zen provider entries.
const SUPPLEMENTAL_MODELS: Readonly<Record<"opencode" | "opencode-go", Readonly<Record<string, ModelSource>>>> = {
  opencode: {},
  "opencode-go": {
    "hy3-preview": {
      id: "hy3-preview",
      name: "Hy3 preview",
      family: "Hy",
      limit: { context: 256_000, input: 192_000, output: 128_000 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text"] },
      reasoning_options: [{ type: "effort", values: ["none", "low", "high"] }],
    },
    "deepseek-flash": {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      family: "deepseek-flash",
      limit: { context: 1_000_000, output: 384_000 },
      reasoning: true,
      reasoning_options: [{ type: "toggle" }, { type: "effort", values: ["low", "high", "max"] }],
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image"] },
      cost: { input: 0.15, output: 0.6, cache_read: 0.003 },
    },
    "minimax-m2.5": {
      id: "minimax-m2.5",
      name: "MiniMax-M2.5",
      family: "minimax",
      limit: { context: 204_800, output: 131_072 },
      reasoning: true,
      reasoning_options: [],
      tool_call: true,
      modalities: { input: ["text"] },
      cost: { input: 0.3, output: 1.2, cache_read: 0.06 },
    },
    "kimi-k2.5": {
      id: "kimi-k2.5",
      name: "Kimi K2.5",
      family: "kimi-k2",
      limit: { context: 262_144, output: 65_536 },
      reasoning: true,
      reasoning_options: [{ type: "toggle" }],
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image", "video"] },
      cost: { input: 0.6, output: 3, cache_read: 0.08 },
    },
    "glm-5.1": {
      id: "glm-5.1",
      name: "GLM-5.1",
      family: "glm",
      limit: { context: 204_800, output: 131_072 },
      reasoning: true,
      reasoning_options: [{ type: "toggle" }],
      tool_call: true,
      modalities: { input: ["text"] },
      cost: { input: 1.4, output: 4.4, cache_read: 0.26 },
    },
    "glm-5": {
      id: "glm-5",
      name: "GLM-5",
      family: "glm",
      limit: { context: 204_800, output: 131_072 },
      reasoning: true,
      reasoning_options: [{ type: "toggle" }],
      tool_call: true,
      modalities: { input: ["text"] },
      cost: { input: 1, output: 3.2, cache_read: 0.2 },
    },
    "qwen3.5-plus": {
      id: "qwen3.5-plus",
      name: "Qwen3.5 Plus",
      family: "qwen3.5",
      limit: { context: 262_144, output: 65_536 },
      reasoning: true,
      reasoning_options: [{ type: "toggle" }, { type: "budget_tokens", max: 81_920 }],
      tool_call: true,
      attachment: true,
      modalities: { input: ["text", "image", "video"] },
      provider: { npm: "@ai-sdk/anthropic" },
      cost: { input: 0.2, output: 1.2, cache_read: 0.02 },
    },
  },
};

// Live discovery may serve a legacy alias id alongside the canonical id for
// the same model. When both appear in one discovery response the alias is
// hidden from the picker; if only the alias is served it keeps its mirrored
// supplemental metadata.
export const ALIAS_MODELS: Readonly<Record<"opencode" | "opencode-go", Readonly<Record<string, string>>>> = {
  opencode: {},
  "opencode-go": { "deepseek-flash": "deepseek-v4.1-flash" },
};

export interface MetadataCache {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

type Fetch = typeof fetch;

export function normalizeModelsDevSnapshot(payload: unknown, fetchedAt: number): ModelsDevSnapshot {
  const root = asRecord(payload);
  return {
    fetchedAt,
    providers: {
      opencode: normalizeProvider(root?.opencode, "opencode"),
      "opencode-go": normalizeProvider(root?.["opencode-go"], "opencode-go"),
    },
  };
}

export function parseCachedModelsDevSnapshot(value: unknown): ModelsDevSnapshot | undefined {
  const snapshot = asRecord(value);
  const providers = asRecord(snapshot?.providers);
  if (!snapshot || !validTimestamp(snapshot.fetchedAt) || !providers) return undefined;
  const zen = normalizeProvider(providers.opencode, "opencode");
  const go = normalizeProvider(providers["opencode-go"], "opencode-go");
  if (!zen && !go) return undefined;
  return { fetchedAt: snapshot.fetchedAt, providers: { opencode: zen, "opencode-go": go } };
}

export class ModelsDevMetadata {
  private snapshot: ModelsDevSnapshot | undefined;
  private refreshPromise: Promise<ModelsDevSnapshot> | undefined;
  private loadedCache = false;

  constructor(
    private readonly cache: MetadataCache,
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = () => Date.now(),
  ) {}

  async getOrRefresh(): Promise<ModelsDevSnapshot> {
    this.loadCache();
    if (!this.snapshot) return this.refresh();
    if (this.now() - this.snapshot.fetchedAt >= MODELS_DEV_CACHE_TTL_MS) void this.refresh();
    return this.snapshot;
  }

  async refresh(): Promise<ModelsDevSnapshot> {
    this.loadCache();
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.fetchAndCache().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async fetchAndCache(): Promise<ModelsDevSnapshot> {
    try {
      const response = await this.fetchImpl(MODELS_DEV_API_URL, { headers: { accept: "application/json" }, signal: timeoutSignal() });
      if (!response.ok) throw new Error(`Models.dev metadata request failed: ${response.status}`);
      const next = normalizeModelsDevSnapshot(await response.json(), this.now());
      if (!next.providers.opencode && !next.providers["opencode-go"]) throw new Error("Models.dev returned no OpenCode providers");
      this.snapshot = next;
      try { await this.cache.update(MODELS_DEV_CACHE_KEY, next); }
      catch { /* A cache write must not hide a successful refresh. */ }
      return next;
    } catch {
      return this.snapshot ?? { fetchedAt: 0, providers: { opencode: undefined, "opencode-go": undefined } };
    }
  }

  private loadCache(): void {
    if (this.loadedCache) return;
    this.loadedCache = true;
    this.snapshot = parseCachedModelsDevSnapshot(this.cache.get<unknown>(MODELS_DEV_CACHE_KEY));
  }
}

function normalizeProvider(value: unknown, fallbackId: "opencode" | "opencode-go"): ProviderSource | undefined {
  const raw = asRecord(value);
  const rawModels = asRecord(raw?.models);
  if (!raw || !rawModels) return undefined;
  const models = Object.fromEntries([
    ...Object.entries(SUPPLEMENTAL_MODELS[fallbackId]).flatMap(([key, supplemental]) => {
      const normalized = normalizeModel(key, supplemental);
      return normalized ? [[key, normalized]] : [];
    }),
    ...Object.entries(rawModels).flatMap(([key, model]) => {
      const normalized = normalizeModel(key, model);
      return normalized ? [[key, normalized]] : [];
    }),
  ]);
  if (!Object.keys(models).length) return undefined;
  return {
    id: stringValue(raw?.id) ?? fallbackId,
    name: stringValue(raw?.name),
    api: stringValue(raw?.api),
    npm: stringValue(raw?.npm),
    models,
    options: asRecord(raw?.options),
  };
}

function normalizeModel(key: string, value: unknown): ModelSource | undefined {
  const raw = asRecord(value);
  if (!raw || !key.trim()) return undefined;
  const limit = asRecord(raw.limit);
  const modalities = asRecord(raw.modalities);
  const provider = asRecord(raw.provider);
  const cost = asRecord(raw.cost);
  return {
    id: stringValue(raw.id) ?? key,
    name: stringValue(raw.name),
    family: stringValue(raw.family),
    limit: {
      context: tokenCount(limit?.context),
      input: tokenCount(limit?.input),
      output: tokenCount(limit?.output),
    },
    reasoning: booleanValue(raw.reasoning),
    reasoning_options: reasoningOptions(raw.reasoning_options),
    tool_call: booleanValue(raw.tool_call),
    attachment: booleanValue(raw.attachment),
    modalities: { input: stringArray(modalities?.input) },
    status: stringValue(raw.status),
    disabled: booleanValue(raw.disabled),
    cost: {
      input: numberValue(cost?.input),
      output: numberValue(cost?.output),
      cacheRead: numberValue(cost?.cache_read),
    },
    provider: { npm: stringValue(provider?.npm), api: stringValue(provider?.api) },
    options: asRecord(raw.options),
  };
}

function reasoningOptions(value: unknown): ReasoningOptionSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options = value.flatMap((item): ReasoningOptionSource[] => {
    const raw = asRecord(item);
    if (!raw) return [];
    return [{ type: stringValue(raw.type), values: stringArray(raw.values), min: numberValue(raw.min), max: numberValue(raw.max) }];
  });
  return options.length ? options : undefined;
}

function timeoutSignal(): AbortSignal | undefined { return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS) : undefined; }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function stringArray(value: unknown): string[] | undefined { const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; return values.length ? values : undefined; }
function tokenCount(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function booleanValue(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function validTimestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
