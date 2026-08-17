import { apiBaseForMode, resolveEndpointKind, type EndpointKind, type OpenCodeMode } from "../transport/protocol";
import type { Credential } from "../auth/auth";
import { ModelsDevMetadata, type MetadataCache, type ModelSource, type ProviderSource } from "./metadata";

export interface OpenCodeModel {
  id: string;
  rawModelId: string;
  providerId: string;
  name: string;
  family: string;
  contextLength: number;
  maxInputTokens?: number;
  maxOutputTokens: number;
  reasoning: boolean;
  reasoningOptions?: ReasoningOption[];
  imageInput: boolean;
  toolCalling: boolean;
  endpoint: EndpointKind;
  baseUrl: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}

export interface ReasoningOption {
  type?: string;
  values?: string[];
  min?: number;
  max?: number;
}

type Fetcher = typeof fetch;
type CatalogCache = MetadataCache;

interface CachedCatalog {
  updatedAt: number;
  models: OpenCodeModel[];
}

const CACHE_KEY_PREFIX = "opencode.modelCatalog.v1";
const CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

export class ModelCatalog {
  private readonly current = new Map<OpenCodeMode, OpenCodeModel[]>();
  private readonly refreshedAt = new Map<OpenCodeMode, number>();
  private readonly scopes = new Map<OpenCodeMode, string>();

  private readonly metadata: ModelsDevMetadata;

  constructor(
    private readonly fetcher: Fetcher = fetch,
    private readonly cache: CatalogCache = memoryCache(),
    metadata?: ModelsDevMetadata,
  ) {
    this.metadata = metadata ?? new ModelsDevMetadata(cache, fetcher);
  }

  list(mode: OpenCodeMode): readonly OpenCodeModel[] {
    return this.current.get(mode) ?? fallbackModels(mode);
  }

  get(mode: OpenCodeMode, id: string): OpenCodeModel | undefined {
    return this.list(mode).find((model) => model.id === id);
  }

  isFresh(mode: OpenCodeMode, maxAgeMs: number, scope?: string): boolean {
    const at = this.refreshedAt.get(mode) ?? 0;
    return at > 0 && Date.now() - at < maxAgeMs && (!scope || this.scopes.get(mode) === scope);
  }

  async refresh(mode: OpenCodeMode, credential: Credential | undefined, freeOnly: boolean, signal?: AbortSignal): Promise<OpenCodeModel[]> {
    const models = mode === "console"
      ? await this.loadConsole(credential, signal)
      : await this.loadPublic(mode, credential, freeOnly, signal);
    if (!models.length) throw new Error(`OpenCode ${mode} returned no usable models`);
    this.current.set(mode, models);
    this.refreshedAt.set(mode, Date.now());
    this.scopes.set(mode, catalogScope(mode, credential, freeOnly));
    if (mode !== "console") {
      try { await this.cache.update(cacheKey(mode, credential, freeOnly), { updatedAt: Date.now(), models }); }
      catch { /* Catalog availability must not depend on persistence. */ }
    }
    return [...models];
  }

  async refreshSafely(mode: OpenCodeMode, credential: Credential | undefined, freeOnly: boolean, signal?: AbortSignal): Promise<readonly OpenCodeModel[]> {
    try {
      return await this.refresh(mode, credential, freeOnly, signal);
    } catch {
      if (mode === "console") {
        // Never expose a public or stale model list for an organization-scoped
        // catalog. An empty picker is safer than showing models from another
        // organization when the selected organization's config is unavailable.
        this.current.delete(mode);
        this.refreshedAt.delete(mode);
        this.scopes.delete(mode);
        return [];
      }
      const cached = this.cache.get<CachedCatalog>(cacheKey(mode, credential, freeOnly));
      if (cached && Date.now() - cached.updatedAt < CACHE_MAX_AGE_MS && Array.isArray(cached.models) && cached.models.length) {
        this.current.set(mode, cached.models);
        this.refreshedAt.set(mode, cached.updatedAt);
        this.scopes.set(mode, catalogScope(mode, credential, freeOnly));
        return cached.models;
      }
      return this.list(mode);
    }
  }

  private async loadPublic(mode: "zen" | "go", credential: Credential | undefined, freeOnly: boolean, signal?: AbortSignal): Promise<OpenCodeModel[]> {
    const providerId = mode === "go" ? "opencode-go" : "opencode";
    const snapshot = await this.metadata.getOrRefresh();
    const provider = snapshot.providers[providerId];
    if (!credential?.token) {
      return provider?.models
        ? modelsFromProvider(mode, providerId, provider, provider.models, freeOnly && mode === "zen")
        : fallbackModels(mode);
    }
    const liveModels = await this.loadLiveModels(mode, credential.token, signal);
    const combined = Object.fromEntries(Object.entries(liveModels).map(([id, live]) => {
      const cached = provider?.models?.[id] ?? provider?.models?.[live.id ?? ""];
      return [id, mergeModelSources(cached, live, id)];
    }));
    return modelsFromProvider(mode, providerId, provider ?? { id: providerId }, combined, freeOnly && mode === "zen");
  }

  private async loadLiveModels(mode: "zen" | "go", token: string, signal?: AbortSignal): Promise<Record<string, ModelSource>> {
    const response = await this.fetcher(`${apiBaseForMode(mode).replace(/\/+$/, "")}/models`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal,
    });
    if (!response.ok) throw new Error(`OpenCode ${mode} model discovery failed (${response.status})`);
    const payload = await response.json() as { data?: unknown[] };
    const models = Object.fromEntries((payload.data ?? []).flatMap((item): Array<[string, ModelSource]> => {
      if (typeof item === "string" && item) return [[item, { id: item }]];
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const source = item as ModelSource;
      return typeof source.id === "string" && source.id ? [[source.id, source]] : [];
    }));
    if (!Object.keys(models).length) throw new Error(`OpenCode ${mode} returned no usable models`);
    return models;
  }

  private async loadConsole(credential: Credential | undefined, signal?: AbortSignal): Promise<OpenCodeModel[]> {
    if (!credential?.token || !credential.server) throw new Error("Sign in to OpenCode Console before loading organization models");
    if (!credential.orgId) throw new Error("Select an OpenCode Console organization before loading models");
    const headers: Record<string, string> = { Accept: "application/json", Authorization: `Bearer ${credential.token}` };
    headers["x-org-id"] = credential.orgId;
    const response = await this.fetcher(`${credential.server.replace(/\/+$/, "")}/api/config`, { headers, signal });
    if (response.status === 404) throw new Error("This OpenCode Console server does not expose organization configuration");
    if (!response.ok) throw new Error(`OpenCode Console model configuration failed (${response.status})`);
    const payload = await response.json() as { config?: { provider?: Record<string, ProviderSource> } };
    const providers = payload.config?.provider ?? {};
    const entries = Object.entries(providers).flatMap(([id, provider]) => {
      const models = provider.models ?? {};
      return modelsFromProvider("console", id, provider, models, false);
    });
    const counts = new Map<string, number>();
    for (const model of entries) counts.set(model.rawModelId, (counts.get(model.rawModelId) ?? 0) + 1);
    return entries.map((model) => counts.get(model.rawModelId)! > 1 ? { ...model, id: `${model.providerId}/${model.rawModelId}` } : model);
  }
}

export function modelsFromProvider(
  mode: OpenCodeMode,
  providerId: string,
  provider: ProviderSource,
  sources: Record<string, ModelSource>,
  freeOnly: boolean,
): OpenCodeModel[] {
  return Object.entries(sources).flatMap(([rawId, source]) => {
    if (source.status === "deprecated" || source.disabled === true) return [];
    if (freeOnly && (source.cost?.input ?? 1) > 0) return [];
    const packageName = source.provider?.npm ?? provider.npm;
    const baseUrl = source.provider?.api ?? provider.api ?? apiBaseForMode(mode === "console" ? "zen" : mode);
    const contextLength = positive(source.limit?.context, 32768);
    const maxOutputTokens = positive(source.limit?.output, Math.min(contextLength, 8192));
    const modelId = source.id ?? rawId;
    return [{
      id: rawId,
      rawModelId: modelId,
      providerId,
      name: source.name ?? rawId,
      family: source.family ?? familyOf(rawId),
      contextLength,
      maxOutputTokens,
      reasoning: source.reasoning === true,
      ...(Array.isArray(source.reasoning_options) ? { reasoningOptions: source.reasoning_options } : {}),
      ...(source.limit?.input ? { maxInputTokens: positive(source.limit.input, contextLength) } : {}),
      imageInput: Array.isArray(source.modalities?.input)
        ? source.modalities.input.includes("image")
        : source.attachment === true,
      toolCalling: source.tool_call === true,
      endpoint: resolveEndpointKind(modelId, mode, packageName),
      baseUrl,
      ...(provider.options?.headers && isStringRecord(provider.options.headers) ? { headers: provider.options.headers } : {}),
      ...((provider.options || source.options) ? { body: withoutCredentials({ ...provider.options, ...source.options }) } : {}),
    }];
  });
}

export function catalogScope(mode: OpenCodeMode, credential: Credential | undefined, freeOnly: boolean): string {
  if (mode === "console") return `${mode}:${credential?.server ?? ""}:${credential?.orgId ?? ""}`;
  return `${mode}:${freeOnly ? "free" : "all"}:${credential?.token ? tokenFingerprint(credential.token) : "anonymous"}`;
}

function cacheKey(mode: "zen" | "go", credential: Credential | undefined, freeOnly: boolean): string {
  return `${CACHE_KEY_PREFIX}:${catalogScope(mode, credential, freeOnly)}`;
}

function tokenFingerprint(token: string): string {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) hash = Math.imul(hash ^ token.charCodeAt(index), 16777619);
  return `authenticated-${(hash >>> 0).toString(16)}`;
}

function mergeModelSources(cached: ModelSource | undefined, live: ModelSource, id: string): ModelSource {
  return {
    ...(cached ?? {}),
    ...live,
    id: live.id ?? cached?.id ?? id,
    limit: { ...(cached?.limit ?? {}), ...(live.limit ?? {}) },
    modalities: { ...(cached?.modalities ?? {}), ...(live.modalities ?? {}) },
    provider: { ...(cached?.provider ?? {}), ...(live.provider ?? {}) },
    cost: { ...(cached?.cost ?? {}), ...(live.cost ?? {}) },
    options: { ...(cached?.options ?? {}), ...(live.options ?? {}) },
  };
}

function memoryCache(): CatalogCache {
  const values = new Map<string, unknown>();
  return {
    get<T>(key: string): T | undefined { return values.get(key) as T | undefined; },
    async update(key: string, value: unknown): Promise<void> { values.set(key, value); },
  };
}

export function fallbackModels(mode: OpenCodeMode): OpenCodeModel[] {
  if (mode === "console") return [];
  const ids = mode === "go"
    ? [["kimi-k2.6", "Kimi K2.6", 262144], ["deepseek-v4-flash", "DeepSeek V4 Flash", 1000000], ["minimax-m3", "MiniMax-M3", 1000000], ["qwen3.7-plus", "Qwen3.7 Plus", 1000000]]
    : [["deepseek-v4-flash-free", "DeepSeek V4 Flash Free", 200000], ["glm-5-free", "GLM-5 Free", 204800], ["minimax-m3-free", "MiniMax-M3 Free", 200000], ["kimi-k2.5", "Kimi K2.5", 262144]];
  return ids.map(([id, name, context]) => ({
    id: String(id), rawModelId: String(id), providerId: mode === "go" ? "opencode-go" : "opencode", name: String(name), family: familyOf(String(id)), contextLength: Number(context), maxOutputTokens: Math.min(Number(context), 32768), reasoning: true, imageInput: false, toolCalling: true, endpoint: resolveEndpointKind(String(id), mode), baseUrl: apiBaseForMode(mode),
  }));
}

function withoutCredentials(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "apiKey" && key !== "headers"));
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.values(value).every((item) => typeof item === "string"));
}

function positive(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function familyOf(id: string): string {
  return id.split(/[/:.-]/)[0].toLowerCase() || "opencode";
}
