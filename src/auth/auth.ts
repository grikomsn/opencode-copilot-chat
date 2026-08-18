import { homedir } from "node:os";
import { join } from "node:path";
import type * as vscode from "vscode";
import { DEFAULT_CONSOLE_SERVER, OPENCODE_CLIENT_ID, type OpenCodeMode } from "../transport/protocol";

const API_KEYS_KEY = "opencode.apiKeys.v1";
const CONSOLE_SESSION_KEY = "opencode.consoleSession.v1";
const CONSOLE_IMPORT_STATE_KEY = "opencode.consoleImportState.v1";
const CONSOLE_PROFILES_KEY = "opencode.consoleProfiles.v1";
export const DEFAULT_CONSOLE_PROFILE = "default";

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

function consoleImportStateKey(profile: string): string {
  return profile === DEFAULT_CONSOLE_PROFILE ? CONSOLE_IMPORT_STATE_KEY : `${CONSOLE_IMPORT_STATE_KEY}.${profile}`;
}

export interface ApiKeys {
  zen?: string;
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
  server?: string;
  orgId?: string;
  orgName?: string;
}

type Fetcher = typeof fetch;
type Sleeper = (milliseconds: number, signal?: AbortSignal) => Promise<void>;

export class OpenCodeAuth {
  private readonly refreshPromises = new Map<string, Promise<ConsoleSession>>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly fetcher: Fetcher = fetch,
    private readonly now: () => number = Date.now,
    private readonly sleep: Sleeper = delay,
    private readonly localImporter: LocalOpenCodeSessionImporter = new LocalOpenCodeSessionImporter(),
  ) {}

  async getApiKeys(): Promise<ApiKeys> {
    const raw = await this.secrets.get(API_KEYS_KEY);
    if (!raw) return {};
    try {
      const value = JSON.parse(raw) as ApiKeys;
      return {
        ...(typeof value.zen === "string" && value.zen.trim() ? { zen: value.zen } : {}),
        ...(typeof value.go === "string" && value.go.trim() ? { go: value.go } : {}),
      };
    } catch {
      return {};
    }
  }

  async setApiKey(mode: "zen" | "go", value: string): Promise<void> {
    const keys = await this.getApiKeys();
    keys[mode] = value.trim();
    await this.secrets.store(API_KEYS_KEY, JSON.stringify(keys));
  }

  async clearApiKey(mode: "zen" | "go"): Promise<void> {
    const keys = await this.getApiKeys();
    delete keys[mode];
    await this.secrets.store(API_KEYS_KEY, JSON.stringify(keys));
  }

  async hasCredential(mode: OpenCodeMode, profile = DEFAULT_CONSOLE_PROFILE): Promise<boolean> {
    if (mode === "console") return Boolean(await this.getConsoleSession(profile));
    return Boolean((await this.getApiKeys())[mode]);
  }

  async getCredential(
    mode: OpenCodeMode,
    forceRefresh = false,
    profile = DEFAULT_CONSOLE_PROFILE,
  ): Promise<Credential | undefined> {
    if (mode !== "console") {
      const token = (await this.getApiKeys())[mode];
      return token ? { mode, token } : undefined;
    }
    const normalized = normalizeConsoleProfile(profile);
    const session = await this.getConsoleSession(normalized);
    if (!session) return undefined;
    const current = !forceRefresh && session.expiresAt > this.now() + 5 * 60_000
      ? session
      : await this.refreshConsoleSession(session, normalized);
    return {
      mode,
      token: current.accessToken,
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
      verificationUrl: verification.startsWith("http") ? verification : `${normalized}${verification}`,
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
      await this.saveConsoleSession(session, normalized);
      return session;
    }
    throw new Error("OpenCode Console device code expired; start sign-in again");
  }

  async selectOrganization(org: ConsoleOrg, profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
    const normalized = normalizeConsoleProfile(profile);
    const session = await this.getConsoleSession(normalized);
    if (!session) throw new Error("Sign in to OpenCode Console first");
    const match = session.orgs.find((item) => item.id === org.id);
    if (!match) throw new Error("That organization is not available to this Console account");
    const next = { ...session, orgId: match.id, orgName: match.name };
    await this.saveConsoleSession(next, normalized);
  }

  async signOut(mode: OpenCodeMode, profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
    if (mode !== "console") {
      await this.clearApiKey(mode);
      return;
    }
    const normalized = normalizeConsoleProfile(profile);
    await this.secrets.delete(consoleSessionKey(normalized));
    await this.secrets.store(consoleImportStateKey(normalized), "signed-out");
    await this.writeConsoleProfileIndex((await this.listConsoleProfiles()).filter((value) => value !== normalized));
  }

  async importLocalConsoleSession(
    force = false,
    profile = DEFAULT_CONSOLE_PROFILE,
  ): Promise<ConsoleSession | undefined> {
    const normalized = normalizeConsoleProfile(profile);
    if (await this.getConsoleSession(normalized)) return undefined;
    if (!force && await this.secrets.get(consoleImportStateKey(normalized))) return undefined;
    const imported = await this.localImporter.readActiveSession();
    if (!imported) return undefined;
    const current = imported.expiresAt > this.now() + 5 * 60_000
      ? imported
      : await this.refreshConsoleSession(imported, normalized, false);
    const orgs = normalizeOrganizations(await this.getJson(current.server, "/api/orgs", current.accessToken) as unknown[]);
    const org = current.orgId
      ? orgs.find((item) => item.id === current.orgId)
      : orgs[0];
    const hydrated: ConsoleSession = {
      ...current,
      orgs,
      ...(org ? { orgId: org.id, orgName: org.name } : {}),
    };
    await this.saveConsoleSession(hydrated, normalized);
    await this.secrets.store(consoleImportStateKey(normalized), "imported");
    return hydrated;
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
    let refreshPromise = this.refreshPromises.get(profile);
    if (!refreshPromise) {
      refreshPromise = (async () => {
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
        const next = { ...session, accessToken, refreshToken, expiresAt: this.now() + positiveNumber(value.expires_in, 3600) * 1000 };
        if (persist) await this.saveConsoleSession(next, profile);
        return next;
      })().finally(() => { this.refreshPromises.delete(profile); });
      this.refreshPromises.set(profile, refreshPromise);
    }
    return refreshPromise;
  }

  private async saveConsoleSession(session: ConsoleSession, profile: string): Promise<void> {
    await this.secrets.store(consoleSessionKey(profile), JSON.stringify(session));
    await this.secrets.store(consoleImportStateKey(profile), "managed");
    const profiles = await this.listConsoleProfiles();
    if (!profiles.includes(profile)) await this.writeConsoleProfileIndex([...profiles, profile]);
  }

  private async writeConsoleProfileIndex(profiles: readonly string[]): Promise<void> {
    await this.secrets.store(CONSOLE_PROFILES_KEY, JSON.stringify([...new Set(profiles)].sort()));
  }

  private async getJson(server: string, path: string, token: string): Promise<unknown> {
    const response = await this.fetcher(`${server}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`OpenCode Console ${path} failed (${response.status})`);
    return response.json();
  }
}

export class LocalOpenCodeSessionImporter {
  private readonly path = join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode", "opencode.db");

  async readActiveSession(): Promise<ConsoleSession | undefined> {
    try {
      const row = await this.withDatabase((db) => db.prepare("SELECT a.id, a.email, a.url, a.access_token, a.refresh_token, a.token_expiry, s.active_org_id FROM account a JOIN account_state s ON s.active_account_id = a.id WHERE s.id = 1").get() as Record<string, unknown> | undefined);
      if (!row) return undefined;
      const accessToken = string(row.access_token);
      const refreshToken = string(row.refresh_token);
      const accountId = string(row.id);
      const email = string(row.email);
      const server = string(row.url);
      if (!accessToken || !refreshToken || !accountId || !email || !server) return undefined;
      return {
        mode: "console",
        server,
        accessToken,
        refreshToken,
        expiresAt: typeof row.token_expiry === "number" ? row.token_expiry : 0,
        accountId,
        email,
        orgs: [],
        ...(string(row.active_org_id) ? { orgId: string(row.active_org_id) } : {}),
      };
    } catch {
      return undefined;
    }
  }

  private async open(): Promise<any> {
    const sqlite = await import("node:sqlite");
    return new sqlite.DatabaseSync(this.path, { readOnly: true, timeout: 5000 });
  }

  private async withDatabase<T>(operation: (database: any) => T): Promise<T> {
    const database = await this.open();
    try {
      return operation(database);
    } finally {
      database.close();
    }
  }
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
