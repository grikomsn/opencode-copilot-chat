import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConsoleProfile, OpenCodeAuth, type DeviceCode } from "./auth";

test("normalizes safe Console profile IDs", () => {
  assert.equal(normalizeConsoleProfile(" Work.Profile "), "work.profile");
  assert.throws(() => normalizeConsoleProfile("work profile"), /Profile IDs/);
});

class Secrets {
  private readonly values = new Map<string, string>();
  constructor(private readonly delayProfileIndex = false) {}
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> {
    if (this.delayProfileIndex && key === "opencode.consoleProfiles.v1") await new Promise((resolve) => setTimeout(resolve, 5));
    this.values.set(key, value);
  }
  async delete(key: string): Promise<void> { this.values.delete(key); }
}

test("stores Zen and Go keys separately", async () => {
  const auth = new OpenCodeAuth(new Secrets() as never);
  await auth.setApiKey("zen", "zen-key");
  await auth.setApiKey("go", "go-key");
  assert.deepEqual(await auth.getApiKeys(), { zen: "zen-key", go: "go-key" });
});

test("completes device flow and selects an organization", async () => {
  let tokenCalls = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) {
      tokenCalls += 1;
      return new Response(JSON.stringify(tokenCalls === 1 ? { error: "authorization_pending" } : { access_token: "access", refresh_token: "refresh", expires_in: 3600 }), { status: 200 });
    }
    if (url.endsWith("/api/user")) return new Response(JSON.stringify({ id: "account", email: "user@example.com" }));
    return new Response(JSON.stringify([{ id: "org-2", name: "Beta" }, { id: "org-1", name: "Alpha" }]));
  };
  const now = () => 1000;
  let localReads = 0;
  const localImporter = { async readActiveSession() { localReads += 1; return undefined; } };
  const auth = new OpenCodeAuth(new Secrets() as never, fetcher, now, async () => undefined, localImporter as never);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };
  const session = await auth.completeDeviceSignIn(device);
  assert.equal(session.orgId, "org-1");
  assert.equal(session.orgName, "Alpha");
  await auth.selectOrganization({ id: "org-2", name: "Beta" });
  assert.equal((await auth.getConsoleSession())?.orgId, "org-2");
  assert.equal(localReads, 0);
});

test("stores named Console sessions separately", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) {
      return Response.json({ access_token: "work-access", refresh_token: "work-refresh", expires_in: 3600 });
    }
    if (url.endsWith("/api/user")) return Response.json({ id: "work", email: "work@example.com" });
    return Response.json([]);
  };
  const auth = new OpenCodeAuth(new Secrets() as never, fetcher, () => 1_000, async () => undefined);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };

  await auth.completeDeviceSignIn(device, undefined, "work");
  assert.equal((await auth.getConsoleSession("work"))?.email, "work@example.com");
  assert.equal(await auth.getConsoleSession(), undefined);
  assert.deepEqual(await auth.listConsoleProfiles(), ["work"]);
});

test("refreshes named Console sessions with isolated locks", async () => {
  const secrets = new Secrets();
  const session = (refreshToken: string) => JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "old", refreshToken,
    expiresAt: 0, accountId: refreshToken, email: `${refreshToken}@example.com`, orgs: [],
  });
  await secrets.store("opencode.consoleSession.v1", session("default-refresh"));
  await secrets.store("opencode.consoleSession.v1.work", session("work-refresh"));
  await secrets.store("opencode.consoleProfiles.v1", JSON.stringify(["work"]));
  let refreshes = 0;
  const auth = new OpenCodeAuth(secrets as never, async (_input, init) => {
    refreshes += 1;
    const body = JSON.parse(String(init?.body)) as { refresh_token: string };
    return Response.json({ access_token: `new-${body.refresh_token}`, expires_in: 3600 });
  }, () => 1_000);

  const [personal, work] = await Promise.all([
    auth.getCredential("console", false, "default"),
    auth.getCredential("console", false, "work"),
  ]);
  assert.equal(personal?.token, "new-default-refresh");
  assert.equal(work?.token, "new-work-refresh");
  assert.equal(refreshes, 2);
});

test("preserves organization selection made during token refresh", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1.work", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "old", refreshToken: "refresh",
    expiresAt: 0, accountId: "work", email: "work@example.com",
    orgs: [{ id: "org-1", name: "Alpha" }, { id: "org-2", name: "Beta" }],
    orgId: "org-1", orgName: "Alpha",
  }));
  let refreshStarted!: () => void;
  let releaseRefresh!: () => void;
  const started = new Promise<void>((resolve) => { refreshStarted = resolve; });
  const wait = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const auth = new OpenCodeAuth(secrets as never, async () => {
    refreshStarted();
    await wait;
    return Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 });
  }, () => 1_000);

  const refreshing = auth.getCredential("console", false, "work");
  await started;
  await auth.selectOrganization({ id: "org-2", name: "Beta" }, "work");
  releaseRefresh();
  await refreshing;

  const session = await auth.getConsoleSession("work");
  assert.equal(session?.accessToken, "new");
  assert.equal(session?.refreshToken, "rotated");
  assert.equal(session?.orgId, "org-2");
  assert.equal(session?.orgName, "Beta");
});

test("serializes concurrent Console profile-index updates", async () => {
  const secrets = new Secrets(true);
  let account = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) {
      account += 1;
      return Response.json({ access_token: `access-${account}`, refresh_token: `refresh-${account}`, expires_in: 3600 });
    }
    if (url.endsWith("/api/user")) return Response.json({ id: `account-${account}`, email: `user-${account}@example.com` });
    return Response.json([]);
  };
  const auth = new OpenCodeAuth(secrets as never, fetcher, () => 1_000, async () => undefined);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };
  await Promise.all([
    auth.completeDeviceSignIn(device, undefined, "personal"),
    auth.completeDeviceSignIn(device, undefined, "work"),
  ]);
  assert.deepEqual(await auth.listConsoleProfiles(), ["personal", "work"]);
});

test("does not persist a Console refresh that finishes after sign-out", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1.work", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "old", refreshToken: "refresh",
    expiresAt: 0, accountId: "work", email: "work@example.com", orgs: [],
  }));
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const auth = new OpenCodeAuth(secrets as never, async () => {
    await wait;
    return Response.json({ access_token: "new", refresh_token: "rotated", expires_in: 3600 });
  }, () => 1_000);
  const refreshing = auth.getCredential("console", false, "work");
  await auth.signOut("console", "work");
  release();
  await assert.rejects(refreshing, /changed while its session was refreshing/);
  assert.equal(await auth.getConsoleSession("work"), undefined);
});

test("does not persist a device sign-in that finishes after sign-out", async () => {
  const secrets = new Secrets();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) {
      await wait;
      return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    }
    if (url.endsWith("/api/user")) return Response.json({ id: "work", email: "work@example.com" });
    return Response.json([]);
  };
  const auth = new OpenCodeAuth(secrets as never, fetcher, () => 1_000, async () => undefined);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };
  const signingIn = auth.completeDeviceSignIn(device, undefined, "work");
  await auth.signOut("console", "work");
  release();
  await assert.rejects(signingIn, /was superseded/);
  assert.equal(await auth.getConsoleSession("work"), undefined);
});

test("does not persist an organization change that finishes after sign-out", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1.work", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "access", refreshToken: "refresh",
    expiresAt: Date.now() + 3600_000, accountId: "work", email: "work@example.com",
    orgs: [{ id: "org", name: "Organization" }],
  }));
  const auth = new OpenCodeAuth(secrets as never);
  const selecting = auth.selectOrganization({ id: "org", name: "Organization" }, "work");
  await auth.signOut("console", "work");
  await assert.rejects(selecting, /was superseded/);
  assert.equal(await auth.getConsoleSession("work"), undefined);
});

test("does not persist a local import that finishes after sign-out", async () => {
  const secrets = new Secrets();
  let release!: () => void;
  let started!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  const importStarted = new Promise<void>((resolve) => { started = resolve; });
  const localImporter = { async readActiveSession() {
    started();
    await wait;
    return {
      mode: "console" as const, server: "https://example.test", accessToken: "access", refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000, accountId: "work", email: "work@example.com", orgs: [],
    };
  } };
  const auth = new OpenCodeAuth(
    secrets as never,
    async () => Response.json([]),
    Date.now,
    undefined,
    localImporter as never,
  );
  const importing = auth.importLocalConsoleSession(true, "work");
  await importStarted;
  await auth.signOut("console", "work");
  release();
  await assert.rejects(importing, /was superseded/);
  assert.equal(await auth.getConsoleSession("work"), undefined);
});

test("signing out of Console clears only the VS Code-managed session", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "access", refreshToken: "refresh",
    expiresAt: Date.now() + 3600_000, accountId: "account", email: "user@example.com", orgs: [], orgId: "org",
  }));
  let localReads = 0;
  const localImporter = { async readActiveSession() { localReads += 1; return undefined; } };
  const auth = new OpenCodeAuth(secrets as never, fetch, Date.now, undefined, localImporter as never);
  assert.ok(await auth.getConsoleSession());
  await auth.signOut("console");
  assert.equal(await auth.getConsoleSession(), undefined);
  assert.equal(localReads, 0);
});

test("keeps the VS Code organization authoritative after local import", async () => {
  const secrets = new Secrets();
  let localReads = 0;
  const localImporter = {
    async readActiveSession() {
      localReads += 1;
      return {
        mode: "console" as const,
        server: "https://example.test",
        accessToken: "local-access",
        refreshToken: "local-refresh",
        expiresAt: 1000,
        accountId: "account",
        email: "user@example.com",
        orgs: [],
        orgId: "org-new",
      };
    },
  };
  await secrets.store("opencode.consoleSession.v1", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "access", refreshToken: "refresh", expiresAt: 1000,
    accountId: "account", email: "user@example.com", orgs: [{ id: "org-old", name: "Old org" }, { id: "org-new", name: "New org" }], orgId: "org-old", orgName: "Old org",
  }));
  const auth = new OpenCodeAuth(secrets as never, fetch, Date.now, undefined, localImporter as never);
  assert.equal((await auth.getConsoleSession())?.orgId, "org-old");
  assert.equal((await auth.getConsoleSession())?.accessToken, "access");
  assert.equal(localReads, 0);
});

test("imports and hydrates a local Console session once into Secret Storage", async () => {
  const secrets = new Secrets();
  let localReads = 0;
  const localImporter = {
    async readActiveSession() {
      localReads += 1;
      return {
        mode: "console" as const,
        server: "https://example.test",
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 3600_000,
        accountId: "account",
        email: "user@example.com",
        orgs: [],
        orgId: "org-2",
      };
    },
  };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify([
    { id: "org-2", name: "Beta" },
    { id: "org-1", name: "Alpha" },
  ]));
  const auth = new OpenCodeAuth(secrets as never, fetcher, Date.now, undefined, localImporter as never);
  const session = await auth.importLocalConsoleSession();
  assert.deepEqual(session?.orgs, [{ id: "org-1", name: "Alpha" }, { id: "org-2", name: "Beta" }]);
  assert.equal(session?.orgName, "Beta");
  assert.equal((await auth.getConsoleSession())?.orgName, "Beta");
  assert.equal(await auth.importLocalConsoleSession(), undefined);
  assert.equal(localReads, 1);
});

test("does not automatically re-import after a VS Code sign-out", async () => {
  const secrets = new Secrets();
  let localReads = 0;
  const localImporter = { async readActiveSession() {
    localReads += 1;
    return {
      mode: "console" as const, server: "https://example.test", accessToken: "access", refreshToken: "refresh",
      expiresAt: Date.now() + 3600_000, accountId: "account", email: "user@example.com", orgs: [],
    };
  } };
  const fetcher: typeof fetch = async () => new Response(JSON.stringify([]));
  const auth = new OpenCodeAuth(secrets as never, fetcher, Date.now, undefined, localImporter as never);
  assert.ok(await auth.importLocalConsoleSession());
  await auth.signOut("console");
  assert.equal(await auth.importLocalConsoleSession(), undefined);
  assert.equal(localReads, 1);
  assert.ok(await auth.importLocalConsoleSession(true));
  assert.equal(localReads, 2);
});
