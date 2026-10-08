import * as vscode from "vscode";
import { DEFAULT_INLINE_GATEWAY, DEFAULT_INLINE_MODEL, INLINE_SUGGESTIONS_GATEWAY_SETTING, INLINE_SUGGESTIONS_MODEL_SETTING, parseInlineGateway, type InlineGateway } from "../autocomplete/config";
import { inlineModelChoicesForGateway } from "../autocomplete/models";
import { DEFAULT_CONSOLE_PROFILE, normalizeConsoleProfile, OpenCodeAuth, type ConsoleOrg } from "../auth/auth";
import { messageOf } from "../errors";
import { OpenCodeProvider } from "../provider";
import { OPENCODE_PROVIDER_DEFINITIONS } from "../provider/definitions";
import { readJournal, reconcile, type StoredAccount } from "../provider-journal";
import type { OpenCodeMode } from "../transport/protocol";
import { formatUsageRows, type UsageDisplayRow } from "../usage/presentation";

export type OpenCodeProviders = Readonly<Record<OpenCodeMode, OpenCodeProvider>>;

const OPEN_MODEL_PICKER_COMMAND = "workbench.action.chat.openModelPicker";

export function registerCommands(
  auth: OpenCodeAuth,
  providers: OpenCodeProviders,
  output: vscode.OutputChannel,
  usageProvider: () => OpenCodeProvider = () => providers[currentMode()],
  journal?: vscode.Memento,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand("opencodeCopilot.manage", () => manage(auth, providers, output, undefined, journal)),
    vscode.commands.registerCommand("opencodeCopilot.manageConsole", () => manage(auth, providers, output, "console", journal)),
    vscode.commands.registerCommand("opencodeCopilot.manageGo", () => manage(auth, providers, output, "go", journal)),
    vscode.commands.registerCommand("opencodeCopilot.addConsoleAccount", () => addConsoleAccount(auth, providers.console, output)),
    vscode.commands.registerCommand("opencodeCopilot.selectConsoleProfile", () => selectConsoleProfile(auth, providers.console)),
    vscode.commands.registerCommand("opencodeCopilot.setInlineSuggestionsModel", () => setInlineSuggestionsModel()),
    vscode.commands.registerCommand("opencodeCopilot.refreshModels", () => refreshModels(providers[currentMode()])),
    vscode.commands.registerCommand("opencodeCopilot.testConnection", () => testConnection(providers[currentMode()], currentMode(), output)),
    vscode.commands.registerCommand("opencodeCopilot.showUsage", () => showUsage(usageProvider())),
    vscode.commands.registerCommand("opencodeCopilot.diagnostics", () => diagnostics(auth, providers, journal)),
  ];
}

async function manage(auth: OpenCodeAuth, providers: OpenCodeProviders, output: vscode.OutputChannel, requestedMode?: OpenCodeMode, journal?: vscode.Memento): Promise<void> {
  const mode = requestedMode ?? currentMode();
  const provider = providers[mode];
  const profile = mode === "console" ? provider.getActiveProfile() : DEFAULT_CONSOLE_PROFILE;
  const signedIn = await auth.hasCredential(profile);
  const choices = signedIn
    ? [
        { label: `$(pulse) Show ${label(mode)} usage`, action: "usage" },
        { label: `$(check) Test ${label(mode)} inference`, action: "test" },
        { label: `$(refresh) Refresh ${label(mode)} models`, action: "refresh" },
        { label: "$(zap) Set inline suggestions model", action: "inlineModel" },
        ...(mode === "console" ? [{ label: "$(organization) Switch Console organization", action: "org" }] : []),
        ...(mode === "console" ? [{ label: "$(account) Select Console profile for usage and management", action: "profile" }, { label: "$(add) Add Console account", action: "addConsole" }] : []),
        { label: "$(device-mobile) Sign in to another OpenCode Console account (device code)", action: "console-device" },
        { label: "$(eye) Review entries and accounts", action: "sync" },
        { label: "$(sign-out) Sign out", action: "signout" },
        { label: "$(output) Show OpenCode logs", action: "logs" },
      ]
    : [
        { label: "$(device-mobile) Sign in with an OpenCode Console account (device code)", action: "console-device" },
        { label: "$(add) Add named Console account", action: "addConsole" },
        { label: "$(account) Select Console profile for usage and management", action: "profile" },
        ...(journal ? [{ label: "$(eye) Review entries and accounts", action: "sync" }] : []),
        { label: "$(output) Show OpenCode logs", action: "logs" },
      ];
  const picked = await vscode.window.showQuickPick(choices, { title: `OpenCode — ${signedIn ? `${label(mode)} connected` : "not connected"}${mode === "console" ? ` [${profile}]` : ""}` });
  if (!picked) return;
  if (picked.action === "logs") output.show(true);
  else if (picked.action === "usage") await showUsage(provider, true);
  else if (picked.action === "test") await testConnection(provider, mode, output);
  else if (picked.action === "refresh") await refreshModels(provider);
  else if (picked.action === "inlineModel") await setInlineSuggestionsModel();
  else if (picked.action === "org") await switchOrganization(auth, provider, output, profile);
  else if (picked.action === "profile") await selectConsoleProfile(auth, providers.console);  else if (picked.action === "addConsole") await addConsoleAccount(auth, providers.console, output);
  else if (picked.action === "signout") await signOut(auth, provider, mode, profile, journal);
  else if (picked.action === "sync" && journal) await showReconciliation(auth, journal);
  else if (picked.action === "console-device") await signInWithConsole(auth, providers.console, output, profile);
  else if (picked.action === "go-device") await signInWithConsoleForMode(auth, providers.go, output, "go");
}

async function signInWithConsole(
  auth: OpenCodeAuth,
  provider: OpenCodeProvider,
  output: vscode.OutputChannel,
  profile = DEFAULT_CONSOLE_PROFILE,
): Promise<void> {
  try {
    await runDeviceSignIn(auth, output, profile);
    await chooseOrganizationForSession(auth, profile);
    await setMode("console");
    provider.setActiveConsoleProfile(profile);
    const models = await provider.refreshModels();
    const selected = await auth.getConsoleSession(profile);
    await offerEntrySetup(
      `OpenCode Console profile “${profile}” connected${selected?.orgName ? ` to ${selected.orgName}` : ""}. Found ${models.length} allowed models.`,
      profile,
    );
  } catch (error) {
    output.appendLine(`[console] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`OpenCode Console sign-in failed: ${messageOf(error)}`);
  }
}

/** Completes sign-in by steering the user to add a model entry that uses the account. */
async function offerEntrySetup(message: string, profile: string): Promise<void> {
  const chosen = await vscode.window.showInformationMessage(message, "Add OpenCode entry", "Copy profile ID");
  if (chosen === "Add OpenCode entry") await vscode.commands.executeCommand(OPEN_MODEL_PICKER_COMMAND);
  else if (chosen === "Copy profile ID") await vscode.env.clipboard.writeText(profile);
}

/** Runs the Console device flow end to end and stores the session for one account. */
async function runDeviceSignIn(auth: OpenCodeAuth, output: vscode.OutputChannel, profile: string): Promise<void> {
  const device = await auth.requestDeviceCode();
  await vscode.env.clipboard.writeText(device.userCode);
  const opened = await vscode.env.openExternal(vscode.Uri.parse(device.verificationUrl));
  if (!opened) throw new Error(`Open ${device.verificationUrl} and enter code ${device.userCode}`);
  vscode.window.showInformationMessage(`OpenCode Console code ${device.userCode} copied to the clipboard.`);
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Waiting for OpenCode Console sign-in…", cancellable: true },
    async (_progress, cancellation) => {
      const controller = new AbortController();
      const listener = cancellation.onCancellationRequested(() => controller.abort());
      try { await auth.completeDeviceSignIn(device!, controller.signal, profile); }
      finally { listener.dispose(); }
    },
  );
  const session = await auth.getConsoleSession(profile);
  if (!session) throw new Error("OpenCode Console sign-in completed without a stored session");
}

/** Chooses an organization for an existing account session, if any are available. */
async function chooseOrganizationForSession(auth: OpenCodeAuth, profile: string): Promise<void> {
  const session = await auth.getConsoleSession(profile);
  if (!session) throw new Error("OpenCode Console sign-in completed without a stored session");
  await chooseOrganization(auth, session.orgs, profile);
}

/**
 * Device-code sign-in that targets the Go gateway: the OpenCode Console
 * account authenticates the user, then the Go provider refreshes models with
 * the account's Console session token, which authenticates both gateways.
 */
async function signInWithConsoleForMode(
  auth: OpenCodeAuth,
  provider: OpenCodeProvider,
  output: vscode.OutputChannel,
  mode: "go",
): Promise<void> {
  try {
    const account = await promptAccount(`Sign in to OpenCode ${label(mode)} with a Console account`, "default, personal or work");
    if (!account) return;
    await runDeviceSignIn(auth, output, account);
    await chooseOrganizationForSession(auth, account);
    await setMode("go");
    const models = await provider.refreshModels();
    const selected = await auth.getConsoleSession(account);
    await offerEntrySetup(`OpenCode ${label(mode)} connected with the Console account “${account}”${selected?.orgName ? ` (${selected.orgName})` : ""}. Found ${models.length} models.`, account);
  } catch (error) {
    output.appendLine(`[console] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`OpenCode ${label(mode)} sign-in failed: ${messageOf(error)}`);
  }
}

/** Prompts for an account profile ID shared by provider entries and stored credentials. */
async function promptAccount(title: string, placeHolder = "default, personal or work"): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title,
    prompt: "Account profile ID; provider entries reference it with their profile field.",
    placeHolder,
    ignoreFocusOut: true,
    validateInput: (input) => {
      try { normalizeConsoleProfile(input); return undefined; } catch (error) { return messageOf(error); }
    },
  });
  return value ? normalizeConsoleProfile(value) : undefined;
}

async function addConsoleAccount(auth: OpenCodeAuth, provider: OpenCodeProvider, output: vscode.OutputChannel): Promise<void> {
  const account = await promptAccount("Add OpenCode Console account", "personal or work");
  if (!account) return;
  const profile = account;
  if (await auth.hasCredential(profile)) {
    const replace = await vscode.window.showWarningMessage(
      `Replace the OpenCode Console session stored for profile “${profile}”?`,
      { modal: true },
      "Replace",
    );
    if (replace !== "Replace") return;
  }
  await signInWithConsole(auth, provider, output, profile);
}

async function selectConsoleProfile(auth: OpenCodeAuth, provider: OpenCodeProvider): Promise<void> {
  const profiles = await auth.listConsoleProfiles();
  if (!profiles.length) {
    vscode.window.showInformationMessage("No OpenCode Console profiles are signed in yet.");
    return;
  }
  const picked = await vscode.window.showQuickPick(
    await Promise.all(profiles.map(async (profile) => {
      const session = await auth.getConsoleSession(profile);
      return { label: profile, description: session?.email ?? "Signed in", detail: session?.orgName, profile };
    })),
    { title: "Select the OpenCode Console profile for usage and management" },
  );
  if (!picked) return;
  provider.setActiveConsoleProfile(picked.profile);
  const choose = await vscode.window.showInformationMessage(
    `OpenCode Console profile “${picked.profile}” is now active for usage and management. Chat requests keep using the account attached to the selected model entry.`,
    "Choose Chat Model",
  );
  if (choose === "Choose Chat Model") await vscode.commands.executeCommand("workbench.action.chat.openModelPicker");
}

async function chooseOrganization(auth: OpenCodeAuth, orgs: readonly ConsoleOrg[], profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
  // Single-org accounts self-select during device authorization; only show
  // the picker when there is a real choice to make.
  if (orgs.length <= 1) return;
  const picked = await vscode.window.showQuickPick(orgs.map((org) => ({ label: org.name, description: org.id, org })), { title: "Choose the OpenCode Console organization" });
  if (!picked) throw new Error("OpenCode Console organization selection was cancelled");
  await auth.selectOrganization(picked.org, profile);
}

async function switchOrganization(auth: OpenCodeAuth, provider: OpenCodeProvider, output: vscode.OutputChannel, profile = DEFAULT_CONSOLE_PROFILE): Promise<void> {
  try {
    const session = await auth.getConsoleSession(profile);
    if (!session) throw new Error("Sign in to OpenCode Console first");
    await chooseOrganization(auth, session.orgs, profile);
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`OpenCode Console organization updated. Found ${models.length} allowed models.`);
  } catch (error) {
    output.appendLine(`[console] ${messageOf(error)}`);
    vscode.window.showErrorMessage(`Unable to switch OpenCode Console organization: ${messageOf(error)}`);
  }
}

async function signOut(auth: OpenCodeAuth, provider: OpenCodeProvider, mode: OpenCodeMode, profile = DEFAULT_CONSOLE_PROFILE, journal?: vscode.Memento): Promise<void> {
  // Sign-out always clears the account's device session; the gateway label
  // only affects the message. Key entries remain valid — keys are user-
  // managed in VS Code provider configuration.
  await auth.signOut(profile);
  if (mode === "console") provider.invalidateConsoleProfile(profile);
  provider.clearUsage();
  provider.fireDidChange();
  const orphans = journal ? await entriesReferencingProfile(journal, profile) : [];
  const message = `Signed out of OpenCode account “${profile}”.`;
  if (orphans.length) {
    const chosen = await vscode.window.showInformationMessage(
      `${message} ${orphans.length} model ${orphans.length === 1 ? "entry still references" : "entries still reference"} this account.`,
      "Open Manage Language Models",
    );
    if (chosen === "Open Manage Language Models") await vscode.commands.executeCommand(OPEN_MODEL_PICKER_COMMAND);
    return;
  }
  vscode.window.showInformationMessage(message);
}

/** Journal entries (model entries VS Code asked about) that reference one account profile. */
async function entriesReferencingProfile(state: vscode.Memento, profile: string): Promise<string[]> {
  return Object.entries(readJournal(state))
    .filter(([key, record]) => record.profile === profile)
    .map(([key]) => key);
}

async function refreshModels(provider: OpenCodeProvider): Promise<void> {
  try {
    const models = await provider.refreshModels();
    vscode.window.showInformationMessage(`Refreshed ${models.length} OpenCode models.`);
  } catch (error) {
    vscode.window.showErrorMessage(`OpenCode model refresh failed: ${messageOf(error)}`);
  }
}

interface InlineModelPickItem extends vscode.QuickPickItem {
  readonly action?: { readonly id: string; readonly gateway: InlineGateway } | "custom";
}

async function setInlineSuggestionsModel(): Promise<void> {
  const configuration = vscode.workspace.getConfiguration("opencode");
  const gateway = parseInlineGateway(configuration.get(INLINE_SUGGESTIONS_GATEWAY_SETTING, DEFAULT_INLINE_GATEWAY));
  const current = configuration.get<string>(INLINE_SUGGESTIONS_MODEL_SETTING, DEFAULT_INLINE_MODEL) ?? DEFAULT_INLINE_MODEL;
  const items: InlineModelPickItem[] = inlineModelChoicesForGateway(gateway, current).map((choice) => ({
    label: choice.label,
    description: choice.description,
    detail: choice.detail,
    action: { id: choice.id, gateway: choice.gateway },
  }));
  const picked = await vscode.window.showQuickPick<InlineModelPickItem>([
    ...items,
    { label: "", kind: vscode.QuickPickItemKind.Separator },
    { label: "$(pencil) Use a custom model id…", detail: "Enter any model id available on the selected gateway.", action: "custom" },
  ], {
    title: "OpenCode — Set Inline Suggestions Model",
    placeHolder: `Current: ${current} (via OpenCode ${gateway === "console" ? "Console" : "Go"})`,
  });
  if (!picked) return;
  if (picked.action === "custom") {
    const value = await vscode.window.showInputBox({
      title: "Custom inline suggestions model id",
      value: current,
      prompt: "Any model id available on the selected gateway; the vetted list is a starting point, not a restriction.",
    });
    if (value === undefined || !value.trim()) return;
    await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, value.trim(), vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage(`OpenCode inline suggestions model set to ${value.trim()}.`);
    return;
  }
  if (!picked.action) return;
  await configuration.update(INLINE_SUGGESTIONS_MODEL_SETTING, picked.action.id, vscode.ConfigurationTarget.Global);
  let suffix = "";
  if (picked.action.gateway !== gateway) {
    await configuration.update(INLINE_SUGGESTIONS_GATEWAY_SETTING, picked.action.gateway, vscode.ConfigurationTarget.Global);
    suffix = ` and switched the gateway to OpenCode ${picked.action.gateway === "console" ? "Console" : "Go"}`;
  }
  void vscode.window.showInformationMessage(`OpenCode inline suggestions model set to ${picked.action.id}${suffix}. Applies on the next keystroke.`);
}

async function testConnection(provider: OpenCodeProvider, mode: OpenCodeMode, output: vscode.OutputChannel): Promise<void> {
  try {
    const result = await provider.testConnection();
    output.appendLine(`[test] mode=${mode} model=${result.model} responseLength=${String(result.text.length)}`);
    vscode.window.showInformationMessage(`OpenCode ${label(mode)} inference verified with ${result.model}: ${result.text.slice(0, 80)}`);
  } catch (error) {
    output.appendLine(`[test] mode=${mode} ${messageOf(error)}`);
    vscode.window.showErrorMessage(`OpenCode connection test failed: ${messageOf(error)}`);
  }
}

interface UsageQuickPickItem extends vscode.QuickPickItem {
  action?: "manage" | "diagnostics";
}

async function showUsage(provider: OpenCodeProvider, management = false): Promise<void> {
  const snapshot = management ? provider.getManagementUsageSnapshot() : provider.getUsageSnapshot();
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

async function diagnostics(auth: OpenCodeAuth, providers: OpenCodeProviders, journal?: vscode.Memento): Promise<void> {
  const modes: readonly OpenCodeMode[] = ["console", "go"];
  const modelGroups = await Promise.all(modes.map(async (mode) => ({
    mode,
    models: await vscode.lm.selectChatModels({ vendor: OPENCODE_PROVIDER_DEFINITIONS[mode].vendor }),
  })));
  const profiles = await auth.listConsoleProfiles();
  const activeConsole = providers.console.getActiveProfile();
  const session = await auth.getConsoleSession(activeConsole);
  const accounts = await storedAccounts(auth);
  const journalLines = journal ? await describeJournal(journal) : [];
  const lines = [
    "# OpenCode Bridge for Copilot Chat diagnostics", "", `- VS Code: ${vscode.version}`,
    `- Console accounts (derived from stored sessions): ${profiles.length ? profiles.join(", ") : "none"}`,
    `- Active Console profile: ${activeConsole}`,
    `- Active Console session: ${session ? "present" : "missing"}`,
    `- Console organization selected: ${session?.orgId ? "yes" : "no"}`,
    `- Accounts: ${accounts.length ? accounts.map((account) => `${account.profile}${account.email ? ` (${account.email})` : ""}`).join(", ") : "none"}`,
    ...journalLines, "",
    ...(await Promise.all(modelGroups.map(async ({ mode, models }) => [
      `## OpenCode ${label(mode)}`,
      "",
      `- Command-managed credential: ${(await auth.hasCredential(mode === "console" ? activeConsole : DEFAULT_CONSOLE_PROFILE)) ? "present" : "missing"}`,
      `- Registered models: ${models.length}`,
      `- Management-entry tracked usage: ${providers[mode].getManagementUsageSnapshot().tracked?.totalTokens ?? 0} tokens`,
      "",
      ...models.map((model) => `- ${model.id} (${model.maxInputTokens} input tokens)`),
      "",
    ]))).flat(),
  ];
  const document = await vscode.workspace.openTextDocument({ content: lines.join("\n"), language: "markdown" });
  await vscode.window.showTextDocument(document, vscode.ViewColumn.Beside);
}

/** Summarizes stored device sessions for reconciliation. */
async function storedAccounts(auth: OpenCodeAuth): Promise<StoredAccount[]> {
  const profiles = await auth.listConsoleProfiles();
  const sessions = await Promise.all(profiles.map(async (profile) => ({ profile, session: await auth.getConsoleSession(profile) })));
  return sessions.map(({ profile, session }) => ({
    profile,
    session: true,
    ...(session?.email ? { email: session.email } : {}),
    ...(session?.orgName ? { orgName: session.orgName } : {}),
  }));
}

/** Human-readable journal summary for diagnostics. */
async function describeJournal(state: vscode.Memento): Promise<string[]> {
  const journal = readJournal(state);
  if (!Object.keys(journal).length) return ["- Model-entry journal: empty (VS Code has not asked for entries yet)"];
  const rows = Object.entries(journal).map(([key, record]) => {
    const details = [record.origin, record.profile ? `profile=${record.profile}` : undefined, record.label ? `label=${record.label}` : undefined]
      .filter(Boolean).join(", ");
    return `  - ${key}: ${details}, ${record.modelCount} models, last asked ${new Date(record.updatedAt).toLocaleString()}`;
  });
  return [`- Model-entry journal (VS Code side):`, ...rows];
}

/** Reconciles stored accounts against the model-entry journal and offers fixes. */
async function showReconciliation(auth: OpenCodeAuth, journal: vscode.Memento): Promise<void> {
  const accounts = await storedAccounts(auth);
  const state = readJournal(journal);
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(state, accounts);
  if (!entriesWithoutCredentials.length && !accountsWithoutEntries.length) {
    const chosen = await vscode.window.showInformationMessage(
      "OpenCode is in sync: every signed-in account is referenced by a model entry, and every device-session entry has a stored session.",
      "Show diagnostics",
    );
    if (chosen === "Show diagnostics") await vscode.commands.executeCommand("opencodeCopilot.diagnostics");
    return;
  }
  const actions: Array<{ label: string; description?: string; run: () => Promise<void> }> = [];
  const staleLabels = entriesWithoutCredentials.map(({ key }) => key).join(", ");
  const orphanAccounts = accountsWithoutEntries.filter((account) => account.session).map((account) => account.profile);
  if (orphanAccounts.length) {
    actions.push({
      label: `$(add) Add an entry for profile ${orphanAccounts.join(", ")}`,
      description: "Signed in, but no model entry uses this account",
      run: async () => { await vscode.commands.executeCommand(OPEN_MODEL_PICKER_COMMAND); },
    });
  }
  if (staleLabels) {
    actions.push({
      label: "$(trash) Review entries without stored credentials",
      description: staleLabels,
      run: async () => { await vscode.commands.executeCommand(OPEN_MODEL_PICKER_COMMAND); },
    });
  }
  actions.push({ label: "$(info) Show full diagnostics", run: async () => { await vscode.commands.executeCommand("opencodeCopilot.diagnostics"); } });
  const picked = await vscode.window.showQuickPick(actions, {
    title: "OpenCode — Review entries and accounts",
    placeHolder: `${entriesWithoutCredentials.length} entr${entriesWithoutCredentials.length === 1 ? "y" : "ies"} without stored credentials, ${accountsWithoutEntries.length} account${accountsWithoutEntries.length === 1 ? "" : "s"} without model entries`,
  });
  if (picked) await picked.run();
}

function currentMode(): OpenCodeMode {
  const value = vscode.workspace.getConfiguration("opencode").get<string>("defaultMode", "console");
  // Legacy `zen` persisted values map onto the Console provider.
  return value === "go" ? "go" : "console";
}

async function setMode(mode: OpenCodeMode): Promise<void> {
  await vscode.workspace.getConfiguration("opencode").update("defaultMode", mode, vscode.ConfigurationTarget.Global);
}

function label(mode: OpenCodeMode): string { return mode === "go" ? "Go" : "Console"; }
