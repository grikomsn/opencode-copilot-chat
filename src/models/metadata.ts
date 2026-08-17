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
  cost?: { input?: number };
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
  const models = Object.fromEntries(Object.entries(rawModels).flatMap(([key, model]) => {
    const normalized = normalizeModel(key, model);
    return normalized ? [[key, normalized]] : [];
  }));
  if (!Object.keys(models).length) return undefined;
  return {
    id: stringValue(raw.id) ?? fallbackId,
    name: stringValue(raw.name),
    api: stringValue(raw.api),
    npm: stringValue(raw.npm),
    models,
    options: asRecord(raw.options),
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
    cost: { input: numberValue(cost?.input) },
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
