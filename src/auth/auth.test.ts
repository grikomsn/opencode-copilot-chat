import assert from "node:assert/strict";
import test from "node:test";
import { normalizeConsoleProfile, OpenCodeAuth, type DeviceCode } from "./auth";

test("normalizes safe Console profile IDs", () => {
  assert.equal(normalizeConsoleProfile(" Work.Profile "), "work.profile");
  assert.throws(() => normalizeConsoleProfile("work profile"), /Profile IDs/);
});

class Secrets {
  private readonly values = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.values.get(key); }
  async store(key: string, value: string): Promise<void> { this.values.set(key, value); }
  async delete(key: string): Promise<void> { this.values.delete(key); }
  async keys(): Promise<string[]> { return [...this.values.keys()]; }
}

interface AuthChangeSpy {
  count(): number;
}

function trackChanges(auth: OpenCodeAuth): AuthChangeSpy {
  let count = 0;
  auth.onDidChange(() => { count += 1; });
  return { count: () => count };
}

test("opens Console device verification at opencode.ai/console/device", async () => {
  const fetcher: typeof fetch = async (input) => {
    assert.equal(String(input), "https://opencode.ai/console/auth/device/code");
    return Response.json({
      device_code: "device",
      user_code: "ABCD-EFGH",
      verification_uri: "/console/device",
      verification_uri_complete: "/console/device?user_code=ABCD-EFGH&client_id=opencode-cli",
      expires_in: 900,
      interval: 5,
    });
  };
  const auth = new OpenCodeAuth(new Secrets() as never, fetcher, () => 1_000);
  const device = await auth.requestDeviceCode();
  assert.equal(device.verificationUrl, "https://opencode.ai/console/device?user_code=ABCD-EFGH&client_id=opencode-cli");
  assert.equal(device.server, "https://opencode.ai/console");
  assert.equal(device.userCode, "ABCD-EFGH");
});

test("lists device accounts from stored sessions without a profile index", async () => {
  const secrets = new Secrets();
  const session = (accessToken: string) => JSON.stringify({
    mode: "console", server: "https://example.test", accessToken, refreshToken: "refresh",
    expiresAt: Date.now() + 3600_000, accountId: accessToken, email: `${accessToken}@example.com`, orgs: [],
  });
  await secrets.store("opencode.consoleSession.v1.work", session("work"));
  await secrets.store("opencode.consoleSession.v1", session("default"));
  // A stale index left by older versions is ignored, not consulted.
  await secrets.store("opencode.consoleProfiles.v1", JSON.stringify(["ghost"]));
  const auth = new OpenCodeAuth(secrets as never);
  assert.deepEqual(await auth.listConsoleProfiles(), ["default", "work"]);
});

test("notifies change listeners for session mutations", async () => {
  const secrets = new Secrets();
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    if (url.endsWith("/api/user")) return Response.json({ id: "work", email: "work@example.com" });
    return Response.json([{ id: "org", name: "Org" }]);
  };
  const auth = new OpenCodeAuth(secrets as never, fetcher, () => 1_000, async () => undefined);
  const changes = trackChanges(auth);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };
  await auth.completeDeviceSignIn(device, undefined, "work");
  await auth.selectOrganization({ id: "org", name: "Org" }, "work");
  await auth.signOut("work");
  // One sign-in, one org selection, one sign-out.
  assert.equal(changes.count(), 3);
});

const device = (server = "https://example.test"): DeviceCode => ({ deviceCode: "device", userCode: "ABCD", verificationUrl: server, expiresAt: 100_000, intervalMs: 1, server });

const sessionFetcher = (): typeof fetch => async (input) => {
  const url = String(input);
  if (url.endsWith("/auth/device/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
  if (url.endsWith("/api/user")) return Response.json({ id: "account", email: "user@example.com" });
  return Response.json([]);
};

const storedSession = (token = "access"): string => JSON.stringify({
  mode: "console", server: "https://example.test", accessToken: token, refreshToken: "refresh",
  expiresAt: Date.now() + 3_600_000, accountId: "account", email: "user@example.com", orgs: [],
});

test("resolves session credentials for either gateway from one account", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1.work", storedSession("work-access"));
  const auth = new OpenCodeAuth(secrets as never);
  for (const mode of ["console", "go"] as const) {
    const credential = await auth.getCredential(mode, false, "work");
    assert.equal(credential?.token, "work-access");
    assert.equal(credential?.origin, "session");
    assert.equal(credential?.mode, mode);
  }
  // The default account is unaffected.
  assert.equal(await auth.getCredential("go", false, "default"), undefined);
});

test("Go device-code sign-in resolves a Console session credential", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/device/token")) return Response.json({ access_token: "access", refresh_token: "refresh", expires_in: 3600 });
    if (url.endsWith("/api/user")) return Response.json({ id: "account", email: "user@example.com" });
    return Response.json([{ id: "org-1", name: "Alpha" }]);
  };
  const auth = new OpenCodeAuth(new Secrets() as never, sessionFetcher(), () => 1_000, async () => undefined);
  await auth.completeDeviceSignIn(device());
  // Go requests authenticate with the Console session token.
  const credential = await auth.getCredential("go");
  assert.equal(credential?.mode, "go");
  assert.equal(credential?.token, "access");
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
  const auth = new OpenCodeAuth(new Secrets() as never, fetcher, now, async () => undefined);
  const device: DeviceCode = { deviceCode: "device", userCode: "ABCD", verificationUrl: "https://example.test", expiresAt: 100_000, intervalMs: 1, server: "https://example.test" };
  const session = await auth.completeDeviceSignIn(device);
  assert.equal(session.orgId, "org-1");
  assert.equal(session.orgName, "Alpha");
  await auth.selectOrganization({ id: "org-2", name: "Beta" });
  assert.equal((await auth.getConsoleSession())?.orgId, "org-2");
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

test("serializes concurrent device sign-ins", async () => {
  const secrets = new Secrets();
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
  await auth.signOut("work");
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
  await auth.signOut("work");
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
  await auth.signOut("work");
  await assert.rejects(selecting, /was superseded/);
  assert.equal(await auth.getConsoleSession("work"), undefined);
});

test("signing out clears the VS Code-managed session", async () => {
  const secrets = new Secrets();
  await secrets.store("opencode.consoleSession.v1", JSON.stringify({
    mode: "console", server: "https://example.test", accessToken: "access", refreshToken: "refresh",
    expiresAt: Date.now() + 3600_000, accountId: "account", email: "user@example.com", orgs: [], orgId: "org",
  }));
  const auth = new OpenCodeAuth(secrets as never);
  assert.ok(await auth.getConsoleSession());
  await auth.signOut();
  assert.equal(await auth.getConsoleSession(), undefined);
});
