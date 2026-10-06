import type * as vscode from "vscode";
import { DEFAULT_CONSOLE_SERVER, OPENCODE_CLIENT_ID, resolveConsoleVerificationUrl, type OpenCodeMode } from "../transport/protocol";

const API_KEYS_KEY = "opencode.apiKeys.v1";
const ACCOUNT_KEYS_KEY = "opencode.accountKeys.v1";
const CONSOLE_SESSION_KEY = "opencode.consoleSession.v1";
const CONSOLE_PROFILES_KEY = "opencode.consoleProfiles.v1";
export const DEFAULT_CONSOLE_PROFILE = "default";

/**
 * Legacy secret blob written by versions that treated Zen as its own provider.
 * It stored `{ zen, go }`; the `zen` entry carried a Console service-account
 * API key and is read as the console slot on load.
 */

export function normalizeConsoleProfile(value: string): string {
  const profile = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(profile)) {
    throw new Error("Profile IDs must start with a letter or number and use only letters, numbers, dots, underscores, or hyphens");
  }
  return profile;
}

function consoleSessionKey(profile: string): string {
  return profile === DEFAULT_CONSOLE_PROFILE ? CONSOLE_SESSION_KEY : `${CONSOLE_SESSION_KEY}.${profile}`;
}

export interface ApiKeys {
  console?: string;
  go?: string;
}

export interface ConsoleOrg {
  id: string;
  name: string;
}

export interface ConsoleSession {
  mode: "console";
  server: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  accountId: string;
  email: string;
  orgs: ConsoleOrg[];
  orgId?: string;
  orgName?: string;
}

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresAt: number;
  intervalMs: number;
  server: string;
}

export interface Credential {
  mode: OpenCodeMode;
  token: string;
  /** Whether the token came from a stored service-account key or a device-flow session. */
  origin: "key" | "session";
  server?: string;
  orgId?: string;
  orgName?: string;
}

type Fetcher = typeof fetch;
type Sleeper = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export class OpenCodeAuth {
  private readonly refreshPromises = new Map<string, { identity: string; promise: Promise<ConsoleSession> }>();
  private readonly sessionMutations = new Map<string, Promise<void>>();
  private profileIndexMutation: Promise<void> = Promise.resolve();
  private accountKeyMutation: Promise<void> = Promise.resolve();
  private accountKeyMigration?: Promise<void>;
  private readonly profileGenerations = new Map<string, number>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleeper = delay,
  ) {}

  /** Default-account keys (the migrated legacy command-managed blob). */
  async getApiKeys(): Promise<ApiKeys> {
    return this.getAccountKeys(DEFAULT_CONSOLE_PROFILE);
  }

  /** Service-account keys for one account; accounts may serve both gateways. */
  async getAccountKeys(account: string = DEFAULT_CONSOLE_PROFILE): Promise<ApiKeys> {
    const normalized = normalizeConsoleProfile(account);
    await this.migrateAccountKeys();
    return (await this.readAccountKeys())[normalized] ?? {};
  }

  async setAccountKey(account: string, mode: OpenCodeMode, value: string): Promise<void> {
    await this.mutateAccountKeys(account, (keys) => { keys[mode] = value.trim(); });
  }

  async setApiKey(mode: OpenCodeMode, value: string): Promise<void> {
    await this.setAccountKey(DEFAULT_CONSOLE_PROFILE, mode, value);
  }

  async clearAccountKey(account: string, mode: OpenCodeMode): Promise<void> {
    await this.mutateAccountKeys(account, (keys) => { delete keys[mode]; });
  }

  async clearApiKey(mode: OpenCodeMode): Promise<void> {
    await this.clearAccountKey(DEFAULT_CONSOLE_PROFILE, mode);
  }

  /** Accounts that hold at least one service-account key. */
  async listKeyAccounts(): Promise<string[]> {
    await this.migrateAccountKeys();
    return Object.keys(await this.readAccountKeys()).sort();
  }

  private async readAccountKeys(): Promise<Record<string, ApiKeys>> {
    const raw = await this.secrets.get(ACCOUNT_KEYS_KEY);
    if (!raw) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const accounts: Record<string, ApiKeys> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      try {
        accounts[normalizeConsoleProfile(key)] = sanitizeApiKeys(value);
      } catch {
        // Invalid account IDs are ignored.
      }
    }
    return accounts;
  }

  private async mutateAccountKeys(account: string, operation: (keys: ApiKeys) => void): Promise<void> {
    await this.migrateAccountKeys();
    const previous = this.accountKeyMutation;
    const current = previous.catch(() => undefined).then(async () => {
      const normalized = normalizeConsoleProfile(account);
      const accounts = await this.readAccountKeys();
      const keys: ApiKeys = { ...accounts[normalized] };
      operation(keys);
      accounts[normalized] = keys;
      await this.secrets.store(ACCOUNT_KEYS_KEY, JSON.stringify(accounts));
    });
    this.accountKeyMutation = current;
    try { await current; } finally {
      if (this.accountKeyMutation === current) this.accountKeyMutation = Promise.resolve();
    }
  }

  /**
   * Seeds per-account keys from the single legacy blob exactly once. The
   * legacy blob stays in place as a downgrade cache; it is only re-read while
   * the account store is absent.
   */
  private migrateAccountKeys(): Promise<void> {
    this.accountKeyMigration ??= (async () => {
      if (await this.secrets.get(ACCOUNT_KEYS_KEY)) return;
      const keys = await this.readLegacyApiKeys();
      await this.secrets.store(ACCOUNT_KEYS_KEY, JSON.stringify({ [DEFAULT_CONSOLE_PROFILE]: keys }));
    })();
    return this.accountKeyMigration;
  }

  private async readLegacyApiKeys(): Promise<ApiKeys> {
    const raw = await this.secrets.get(API_KEYS_KEY);
    if (!raw) return {};
    let parsed: (ApiKeys & { zen?: unknown }) | undefined;
    try {
      parsed = JSON.parse(raw) as ApiKeys & { zen?: unknown };
    } catch {
      return {};
    }
    // Versions before the Console transition stored the Console
    // service-account key under the legacy `zen` slot of this same blob.
    // Rewrite the blob once so persisted state matches the current shape.
    const hasLegacy = typeof parsed.zen === "string" && parsed.zen.trim() && !parsed.console;
    if (hasLegacy) {
      const migrated: ApiKeys = {
        console: (parsed.zen as string).trim(),
        ...(typeof parsed.go === "string" && parsed.go.trim() ? { go: parsed.go.trim() } : {}),
      };
      await this.secrets.store(API_KEYS_KEY, JSON.stringify(migrated));
      return migrated;
    }
    return sanitizeApiKeys(parsed);
  }

  async hasCredential(mode: OpenCodeMode, profile = DEFAULT_CONSOLE_PROFILE): Promise<boolean> {
    if ((await this.getAccountKeys(profile))[mode]) return true;
    return Boolean(await this.getConsoleSession(profile));
  }

  async getCredential(
    mode: OpenCodeMode,
    forceRefresh = false,
    profile = DEFAULT_CONSOLE_PROFILE,
  ): Promise<Credential | undefined> {
    // A stored service-account API key takes precedence over the device-flow
    // session within one account, mirroring the upstream key method's
    // precedence. Keys and sessions are account-scoped, so one named account
    // can serve both the Console and Go gateways; device sign-in for either
    // mode stores a shared Console session.
    // The session is snapshotted first so a concurrent sign-out is detected
    // by the refresh generation guard instead of resolving from a session
    // that vanished mid-read.
    const normalized = normalizeConsoleProfile(profile);
    const session = await this.getConsoleSession(normalized);
    const apiKey = (await this.getAccountKeys(normalized))[mode];
    if (apiKey && !forceRefresh) return { mode, token: apiKey, origin: "key" };
    if (!session) return undefined;
    const current = !forceRefresh && session.expiresAt > this.now() + 5 * 60_000
      ? session
      : await this.refreshConsoleSession(session, normalized);
    return {
      mode,
      token: current.accessToken,
      origin: "session",
      server: current.server,
      orgId: current.orgId,
      orgName: current.orgName,
    };
  }

  async getConsoleSession(profile = DEFAULT_CONSOLE_PROFILE): Promise<ConsoleSession | undefined> {
    const raw = await this.secrets.get(consoleSessionKey(normalizeConsoleProfile(profile)));
    return raw ? parseSession(raw) : undefined;
  }

  async requestDeviceCode(server = DEFAULT_CONSOLE_SERVER): Promise<DeviceCode> {
    const normalized = server.replace(/\/+$/, "");
    const response = await this.fetcher(`${normalized}/auth/device/code`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: OPENCODE_CLIENT_ID }),
    });
    if (!response.ok) throw new Error(`OpenCode Console device authorization failed (${response.status})`);
    const value = await response.json() as Record<string, unknown>;
    const deviceCode = string(value.device_code);
    const userCode = string(value.user_code);
    const verification = string(value.verification_uri_complete);
    const expiresIn = positiveNumber(value.expires_in, 600);
    if (!deviceCode || !userCode || !verification) throw new Error("OpenCode Console returned an incomplete device-code response");
    return {
      deviceCode,
      userCode,
      verificationUrl: resolveConsoleVerificationUrl(normalized, verification),
      expiresAt: this.now() + expiresIn * 1000,
      intervalMs: Math.max(1000, positiveNumber(value.interval, 5) * 1000),
      server: normalized,
    };
  }

  async completeDeviceSignIn(
    device: DeviceCode,
    signal?: AbortSignal,
    profile = DEFAULT_CONSOLE_PROFILE,
  ): Promise<ConsoleSession> {
    const normalized = normalizeConsoleProfile(profile);
    const generation = this.beginSessionReplacement(normalized);
    let intervalMs = device.intervalMs;
    while (this.now() < device.expiresAt) {
      await this.sleep(intervalMs, signal);
      const response = await this.fetcher(`${device.server}/auth/device/token`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.deviceCode,
          client_id: OPENCODE_CLIENT_ID,
        }),
        signal,
      });
      const value = await response.json() as Record<string, unknown>;
      const error = string(value.error);
      if (error === "authorization_pending") continue;
      if (error === "slow_down") {
        intervalMs += 5000;
        continue;
      }
      if (error === "expired_token") throw new Error("OpenCode Console device code expired; start sign-in again");
      if (error === "access_denied") throw new Error("OpenCode Console sign-in was denied");
      const accessToken = string(value.access_token);
      const refreshToken = string(value.refresh_token);
      if (!response.ok || !accessToken || !refreshToken) throw new Error(`OpenCode Console token exchange failed (${response.status})`);
      const [user, orgs] = await Promise.all([
        this.getJson(device.server, "/api/user", accessToken) as Promise<{ id?: unknown; email?: unknown }>,
        this.getJson(device.server, "/api/orgs", accessToken) as Promise<unknown[]>,
      ]);
      const normalizedOrgs = normalizeOrganizations(orgs);
      const accountId = string(user.id);
      const email = string(user.email);
      if (!accountId || !email) throw new Error("OpenCode Console returned incomplete account information");
      const session: ConsoleSession = {
        mode: "console",
        server: device.server,
        accessToken,
        refreshToken,
        expiresAt: this.now() + positiveNumber(value.expires_in, 3600) * 1000,
        accountId,
        email,
        orgs: normalizedOrgs,
        ...(normalizedOrgs[0] ? { orgId: normalizedOrgs[0].id, orgName: normalizedOrgs[0].name } : {}),
      };
      await this.saveConsoleSession(session, normalized, generation);
      return session;
    }
    throw new Error("OpenCode Console device code expired; start sign-in again");
  }

  async selectOrganization(org: ConsoleOrg, profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
    const normalized = normalizeConsoleProfile(profile);
    const generation = this.profileGeneration(normalized);
    await this.mutateSession(normalized, async () => {
      if (this.profileGeneration(normalized) !== generation) {
        throw new Error(`OpenCode Console operation for profile “${normalized}” was superseded`);
      }
      const session = await this.getConsoleSession(normalized);
      if (!session) throw new Error("Sign in to OpenCode Console first");
      const match = session.orgs.find((item) => item.id === org.id);
      if (!match) throw new Error("That organization is not available to this Console account");
      await this.storeConsoleSession({ ...session, orgId: match.id, orgName: match.name }, normalized);
      if (this.profileGeneration(normalized) !== generation) {
        throw new Error(`OpenCode Console operation for profile “${normalized}” was superseded`);
      }
    });
  }

  async signOut(mode: OpenCodeMode, profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
    // Signing out clears the account's service-account key. For Console it
    // also clears the device-flow session so the next sign-in starts clean;
    // Go device sign-ins share that session, so it is intentionally
    // preserved. Profile invalidation happens before any await so concurrent
    // session operations cannot persist into a signed-out account.
    if (mode === "console") {
      const normalized = normalizeConsoleProfile(profile);
      this.invalidateProfile(normalized);
      await this.mutateSession(normalized, async () => {
        await this.secrets.delete(consoleSessionKey(normalized));
        await this.mutateConsoleProfileIndex((profiles) => profiles.delete(normalized));
      });
    }
    await this.clearApiKey(mode);
  }

  async listConsoleProfiles(): Promise<string[]> {
    let candidates: string[] = [];
    try {
      const parsed = JSON.parse(await this.secrets.get(CONSOLE_PROFILES_KEY) ?? "[]") as unknown;
      if (Array.isArray(parsed)) candidates = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      // A corrupt index is rebuilt from the legacy default session.
    }
    candidates.push(DEFAULT_CONSOLE_PROFILE);
    const profiles: string[] = [];
    for (const candidate of candidates) {
      try {
        const profile = normalizeConsoleProfile(candidate);
        if (!profiles.includes(profile) && await this.getConsoleSession(profile)) profiles.push(profile);
      } catch {
        // Invalid index entries are ignored.
      }
    }
    return profiles.sort();
  }

  private async refreshConsoleSession(
    session: ConsoleSession,
    profile: string,
    persist = true,
  ): Promise<ConsoleSession> {
    const identity = consoleSessionIdentity(session);
    const generation = this.profileGeneration(profile);
    const existing = this.refreshPromises.get(profile);
    if (existing?.identity === identity) return existing.promise;
    let promise: Promise<ConsoleSession>;
    promise = (async () => {
        const response = await this.fetcher(`${session.server}/auth/device/token`, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ grant_type: "refresh_token", refresh_token: session.refreshToken, client_id: OPENCODE_CLIENT_ID }),
        });
        if (!response.ok) throw new Error(`OpenCode Console token refresh failed (${response.status})`);
        const value = await response.json() as Record<string, unknown>;
        const accessToken = string(value.access_token);
        const refreshToken = string(value.refresh_token) ?? session.refreshToken;
        if (!accessToken) throw new Error("OpenCode Console token refresh returned no access token");
        const expiresAt = this.now() + positiveNumber(value.expires_in, 3600) * 1000;
        let next = { ...session, accessToken, refreshToken, expiresAt };
        if (persist) {
          let persisted = false;
          await this.mutateSession(profile, async () => {
            const current = await this.getConsoleSession(profile);
            if (this.profileGeneration(profile) === generation && current && consoleSessionIdentity(current) === identity) {
              next = { ...current, accessToken, refreshToken, expiresAt };
              await this.storeConsoleSession(next, profile);
              persisted = this.profileGeneration(profile) === generation;
            }
          });
          if (!persisted) throw new Error(`OpenCode Console profile “${profile}” changed while its session was refreshing`);
        }
        return next;
      })().finally(() => {
        if (this.refreshPromises.get(profile)?.promise === promise) this.refreshPromises.delete(profile);
      });
    this.refreshPromises.set(profile, { identity, promise });
    return promise;
  }

  private async saveConsoleSession(session: ConsoleSession, profile: string, expectedGeneration: number): Promise<void> {
    const normalized = normalizeConsoleProfile(profile);
    await this.mutateSession(normalized, async () => {
      if (this.profileGeneration(normalized) !== expectedGeneration) {
        throw new Error(`OpenCode Console operation for profile “${normalized}” was superseded`);
      }
      await this.storeConsoleSession(session, normalized);
      if (this.profileGeneration(normalized) !== expectedGeneration) {
        throw new Error(`OpenCode Console operation for profile “${normalized}” was superseded`);
      }
    });
  }

  private async storeConsoleSession(session: ConsoleSession, profile: string): Promise<void> {
    await this.secrets.store(consoleSessionKey(profile), JSON.stringify(session));
    await this.mutateConsoleProfileIndex((profiles) => { profiles.add(profile); });
  }

  private async readConsoleProfileIndex(): Promise<Set<string>> {
    try {
      const parsed = JSON.parse(await this.secrets.get(CONSOLE_PROFILES_KEY) ?? "[]") as unknown;
      return new Set(Array.isArray(parsed) ? parsed.flatMap((value) => {
        try { return typeof value === "string" ? [normalizeConsoleProfile(value)] : []; } catch { return []; }
      }) : []);
    } catch {
      return new Set<string>();
    }
  }

  private async mutateSession(profile: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.sessionMutations.get(profile) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    this.sessionMutations.set(profile, current);
    try { await current; } finally {
      if (this.sessionMutations.get(profile) === current) this.sessionMutations.delete(profile);
    }
  }

  private async mutateConsoleProfileIndex(operation: (profiles: Set<string>) => void): Promise<void> {
    const current = this.profileIndexMutation.catch(() => undefined).then(async () => {
      const profiles = await this.readConsoleProfileIndex();
      operation(profiles);
      await this.secrets.store(CONSOLE_PROFILES_KEY, JSON.stringify([...profiles].sort()));
    });
    this.profileIndexMutation = current;
    await current;
  }

  private profileGeneration(profile: string): number {
    return this.profileGenerations.get(profile) ?? 0;
  }

  private beginSessionReplacement(profile: string): number {
    const generation = this.profileGeneration(profile) + 1;
    this.profileGenerations.set(profile, generation);
    return generation;
  }

  private invalidateProfile(profile: string): void {
    this.profileGenerations.set(profile, this.profileGeneration(profile) + 1);
  }

  private async getJson(server: string, path: string, token: string): Promise<unknown> {
    const response = await this.fetcher(`${server}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`OpenCode Console ${path} failed (${response.status})`);
    return response.json();
  }
}

function consoleSessionIdentity(session: ConsoleSession): string {
  return `${session.accessToken}\u0000${session.refreshToken}\u0000${session.expiresAt}`;
}

function parseSession(raw: string): ConsoleSession | undefined {
  try {
    const value = JSON.parse(raw) as Partial<ConsoleSession>;
    if (value.mode !== "console" || !string(value.server) || !string(value.accessToken) || !string(value.refreshToken) || !string(value.accountId) || !string(value.email) || typeof value.expiresAt !== "number" || !Array.isArray(value.orgs)) return undefined;
    return value as ConsoleSession;
  } catch {
    return undefined;
  }
}

function normalizeOrganizations(value: unknown[]): ConsoleOrg[] {
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const org = item as Record<string, unknown>;
    const id = string(org.id);
    const name = string(org.name);
    return id && name ? [{ id, name }] : [];
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sanitizeApiKeys(value: unknown): ApiKeys {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const keys: ApiKeys = {};
  if (typeof source.console === "string" && source.console.trim()) keys.console = source.console;
  if (typeof source.go === "string" && source.go.trim()) keys.go = source.go;
  return keys;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("OpenCode Console sign-in cancelled"));
    }, { once: true });
  });
}
