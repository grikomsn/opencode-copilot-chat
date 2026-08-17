import * as vscode from "vscode";
import { OpenCodeAuth, type ConsoleOrg } from "../auth/auth";
import { messageOf } from "../errors";
import { OpenCodeProvider } from "../provider";
import { OPENCODE_PROVIDER_DEFINITIONS } from "../provider/definitions";
import type { OpenCodeMode } from "../transport/protocol";
import { formatUsageRows, type UsageDisplayRow } from "../usage/presentation";

export type OpenCodeProviders = Readonly<Record<OpenCodeMode, OpenCodeProvider>>;

export function registerCommands(auth: OpenCodeAuth, providers: OpenCodeProviders, output: vscode.OutputChannel): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("opencodeCopilot.manage", () => manage(auth, providers, output)),
    vscode.commands.registerCommand("opencodeCopilot.manageZen", () => manage(auth, providers, output, "zen")),
    vscode.commands.registerCommand("opencodeCopilot.manageGo", () => manage(auth, providers, output, "go")),
    vscode.commands.registerCommand("opencodeCopilot.manageConsole", () => manage(auth, providers, output, "console")),
    vscode.commands.registerCommand("opencodeCopilot.importConsoleSession", () => importConsoleSession(auth, providers.console, output)),
    vscode.commands.registerCommand("opencodeCopilot.refreshModels", () => refreshModels(providers[currentMode()])),
    vscode.commands.registerCommand("opencodeCopilot.testConnection", () => testConnection(providers[currentMode()], currentMode(), output)),
    vscode.commands.registerCommand("opencodeCopilot.showUsage", () => showUsage(providers[currentMode()])),
    vscode.commands.registerCommand("opencodeCopilot.diagnostics", () => diagnostics(auth, providers)),
  ];
}

async function manage(auth: OpenCodeAuth, providers: OpenCodeProviders, output: vscode.OutputChannel, requestedMode?: OpenCodeMode): Promise<void> {
  const mode = requestedMode ?? currentMode();
  const provider = providers[mode];
  const signedIn = await auth.hasCredential(mode);
  const choices = signedIn
    ? [
        { label: `$(pulse) Show ${label(mode)} usage`, action: "usage" },
        { label: `$(check) Test ${label(mode)} inference`, action: "test" },
        { label: `$(refresh) Refresh ${label(mode)} models`, action: "refresh" },
        ...(mode === "console" ? [{ label: "$(organization) Switch Console organization", action: "org" }] : []),
        { label: "$(key) Add or switch OpenCode credential", action: "switch" },
        { label: "$(sign-out) Sign out", action: "signout" },
        { label: "$(output) Show OpenCode logs", action: "logs" },
      ]
    : [
        { label: "$(key) Sign in with OpenCode Zen API key", action: "zen" },
        { label: "$(key) Sign in with OpenCode Go API key", action: "go" },
        { label: "$(device-mobile) Sign in with OpenCode Console device code", action: "console" },
        { label: "$(database) Import Console session from local OpenCode", action: "importConsole" },
        { label: "$(output) Show OpenCode logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, { title: `OpenCode — ${signedIn ? `${label(mode)} connected` : "not connected"}` });
  if (!picked) return;
  if (picked.action === "logs") output.show(true);
  else if (picked.action === "usage") await showUsage(provider);
  else if (picked.action === "test") await testConnection(provider, mode, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "org") await switchOrganization(auth, provider, output);
  else if (picked.action === "signout") await signOut(auth, provider, mode);
  else if (picked.action === "switch") await chooseModeAndSignIn(auth, providers, output);
  else if (picked.action === "zen" || picked.action === "go") await signInWithApiKey(auth, providers[picked.action], picked.action);
  else if (picked.action === "console") await signInWithConsole(auth, providers.console, output);
  else if (picked.action === "importConsole") await importConsoleSession(auth, providers.console, output);
}

async function chooseModeAndSignIn(auth: OpenCodeAuth, providers: OpenCodeProviders, output: vscode.OutputChannel): Promise<void> {
  const picked = await vscode.window.showQuickPick([
    { label: "OpenCode Zen API key", mode: "zen" as const },
    { label: "OpenCode Go API key", mode: "go" as const },
    { label: "OpenCode Console device code", mode: "console" as const },
    { label: "Import Console session from local OpenCode", mode: "importConsole" as const },
  ], { title: "Choose an OpenCode credential mode" });
  if (!picked) return;
  if (picked.mode === "console") await signInWithConsole(auth, providers.console, output);
  else if (picked.mode === "importConsole") await importConsoleSession(auth, providers.console, output);
  else await signInWithApiKey(auth, providers[picked.mode], picked.mode);
}

async function importConsoleSession(auth: OpenCodeAuth, provider: OpenCodeProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const session = await auth.importLocalConsoleSession(true);
    if (!session) {
      vscode.window.showInformationMessage("No importable OpenCode Console session was found in the local opencode.db.");
      return;
    }
    await setMode("console");
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Imported OpenCode Console into VS Code${session.orgName ? ` for ${session.orgName}` : ""}. Found ${models.length} allowed models.`);
  } catch (error) {
    output.appendLine(`[console] local import failed: ${messageOf(error)}`);
    vscode.window.showErrorMessage(`Unable to import the local OpenCode Console session: ${messageOf(error)}`);
  }
}

async function signInWithApiKey(auth: OpenCodeAuth, provider: OpenCodeProvider, mode: "zen" | "go"): Promise<void> {
  const key = await vscode.window.showInputBox({
    title: `OpenCode ${label(mode)} API key`,
    prompt: `Paste your OpenCode ${label(mode)} API key`,
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : "An API key is required",
  });
  if (!key) return;
  try {
    await auth.setApiKey(mode, key);
    await setMode(mode);
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`OpenCode ${label(mode)} connected. Found ${models.length} models.`);
  } catch (error) {
    vscode.window.showErrorMessage(`OpenCode ${label(mode)} sign-in failed: ${messageOf(error)}`);
  }
}

async function signInWithConsole(auth: OpenCodeAuth, provider: OpenCodeProvider, output: vscode.OutputChannel): Promise<void> {
  let device: Awaited<ReturnType<OpenCodeAuth["requestDeviceCode"]>> | undefined;
  try {
    device = await auth.requestDeviceCode();
    await vscode.env.clipboard.writeText(device.userCode);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(device.verificationUrl));
    if (!opened) throw new Error(`Open ${device.verificationUrl} and enter code ${device.userCode}`);
    vscode.window.showInformationMessage(`OpenCode Console code ${device.userCode} copied to the clipboard.`);
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Waiting for OpenCode Console sign-in…", cancellable: true },
      async (_progress, cancellation) => {
        const controller = new AbortController();
        const listener = cancellation.onCancellationRequested(() => controller.abort());
        try { await auth.completeDeviceSignIn(device!, controller.signal); }
        finally { listener.dispose(); }
      },
    );
    const session = await auth.getConsoleSession();
    if (!session) throw new Error("OpenCode Console sign-in completed without a stored session");
    await chooseOrganization(auth, session.orgs);
    await setMode("console");
    const models = await provider.refreshModels();
    const selected = await auth.getConsoleSession();
    vscode.window.showInformationMessage(`OpenCode Console connected${selected?.orgName ? ` to ${selected.orgName}` : ""}. Found ${models.length} allowed models.`);
  } catch (error) {
    output.appendLine(`[console] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`OpenCode Console sign-in failed: ${messageOf(error)}`);
  }
}

async function chooseOrganization(auth: OpenCodeAuth, orgs: readonly ConsoleOrg[]): Promise<void> {
  if (orgs.length === 0) return;
  const picked = await vscode.window.showQuickPick(orgs.map((org) => ({ label: org.name, description: org.id, org })), { title: "Choose the OpenCode Console organization" });
  if (!picked) throw new Error("OpenCode Console organization selection was cancelled");
  await auth.selectOrganization(picked.org);
}

async function switchOrganization(auth: OpenCodeAuth, provider: OpenCodeProvider, output: vscode.OutputChannel): Promise<void> {
  try {
    const session = await auth.getConsoleSession();
    if (!session) throw new Error("Sign in to OpenCode Console first");
    await chooseOrganization(auth, session.orgs);
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`OpenCode Console organization updated. Found ${models.length} allowed models.`);
  } catch (error) {
    output.appendLine(`[console] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`Unable to switch OpenCode Console organization: ${messageOf(error)}`);
  }
}

async function signOut(auth: OpenCodeAuth, provider: OpenCodeProvider, mode: OpenCodeMode): Promise<void> {
  await auth.signOut(mode);
  provider.clearUsage();
  provider.fireDidChange();
  vscode.window.showInformationMessage(`Signed out of OpenCode ${label(mode)}.`);
}

async function refreshModels(provider: OpenCodeProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} OpenCode models.`);
  } catch (error) {
    vscode.window.showErrorMessage(`OpenCode model refresh failed: ${messageOf(error)}`);
  }
}

async function testConnection(provider: OpenCodeProvider, mode: OpenCodeMode, output: vscode.OutputChannel): Promise<void> {
  try {
    await provider.refreshModels();
    const models = await vscode.lm.selectChatModels({ vendor: OPENCODE_PROVIDER_DEFINITIONS[mode].vendor });
    const model = models[0];
    if (!model) throw new Error(`OpenCode ${label(mode)} registered no usable models`);
    const cancellation = new vscode.CancellationTokenSource();
    let text = "";
    try {
      const response = await model.sendRequest(
        [vscode.LanguageModelChatMessage.User("Reply with OK.")],
        { justification: "Verify the configured OpenCode provider connection" },
        cancellation.token,
      );
      for await (const chunk of response.text) {
        text += chunk;
        if (text.length >= 80) break;
      }
    } finally {
      cancellation.dispose();
    }
    if (!text.trim()) throw new Error(`${model.name} returned no text`);
    output.appendLine(`[test] mode=${mode} model=${model.id} responseLength=${String(text.length)}`);
    vscode.window.showInformationMessage(`OpenCode ${label(mode)} inference verified with ${model.name}: ${text.trim().slice(0, 80)}`);
  } catch (error) {
    output.appendLine(`[test] mode=${mode} ${messageOf(error)}`);
    vscode.window.showErrorMessage(`OpenCode connection test failed: ${messageOf(error)}`);
  }
}

interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "manage" | "diagnostics";
}

async function showUsage(provider: OpenCodeProvider): Promise<void> {
  const snapshot = provider.getUsageSnapshot();
  const picked = await vscode.window.showQuickPick<UsageQuickPickItem>([
    ...formatUsageRows(snapshot).map(toUsageQuickPickItem),
    { label: "Actions", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(account) Manage OpenCode connection", action: "manage", alwaysShow: true },
    { label: "$(info) Show diagnostics", action: "diagnostics", alwaysShow: true },
  ], {
    title: snapshot.updatedAt ? `OpenCode usage — updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}` : "OpenCode usage",
    placeHolder: "Locally tracked OpenCode inference tokens",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (picked?.action === "manage") await vscode.commands.executeCommand("opencodeCopilot.manage");
  else if (picked?.action === "diagnostics") await vscode.commands.executeCommand("opencodeCopilot.diagnostics");
}

function toUsageQuickPickItem(row: UsageDisplayRow): UsageQuickPickItem {
  const icon = { tracked: "$(symbol-numeric)", request: "$(history)", empty: "$(circle-slash)" }[row.kind];
  return { label: `${icon} ${row.label}`, description: row.description, detail: row.detail, alwaysShow: true };
}

async function diagnostics(auth: OpenCodeAuth, providers: OpenCodeProviders): Promise<void> {
  const modes: readonly OpenCodeMode[] = ["zen", "go", "console"];
  const modelGroups = await Promise.all(modes.map(async (mode) => ({
    mode,
    models: await vscode.lm.selectChatModels({ vendor: OPENCODE_PROVIDER_DEFINITIONS[mode].vendor }),
  })));
  const session = await auth.getConsoleSession();
  const lines = [
    "# OpenCode for Copilot Chat diagnostics", "", `- VS Code: ${vscode.version}`,
    `- Console session: ${session ? "present" : "missing"}`,
    `- Console organization selected: ${session?.orgId ? "yes" : "no"}`, "",
    ...(await Promise.all(modelGroups.map(async ({ mode, models }) => [
      `## OpenCode ${label(mode)}`,
      "",
      `- Credential: ${(await auth.hasCredential(mode)) ? "present" : "missing"}`,
      `- Registered models: ${models.length}`,
      `- Tracked usage: ${providers[mode].getUsageSnapshot().tracked?.totalTokens ?? 0} tokens`,
      "",
      ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
      "",
    ]))).flat(),
  ];
  const document = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

function currentMode(): OpenCodeMode {
  const value = vscode.workspace.getConfiguration("opencode").get<string>("defaultMode", "zen");
  return value === "go" || value === "console" ? value : "zen";
}

async function setMode(mode: OpenCodeMode): Promise<void> {
  await vscode.workspace.getConfiguration("opencode").update("defaultMode", mode, vscode.ConfigurationTarget.Global);
}

function label(mode: OpenCodeMode): string { return mode === "go" ? "Go" : mode === "console" ? "Console" : "Zen"; }
