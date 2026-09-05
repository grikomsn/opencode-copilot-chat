import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete";
import { OpenCodeAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { OpenCodeProvider } from "./provider";
import { ModelCatalog } from "./models/catalog";
import { ModelsDevMetadata } from "./models/metadata";
import { OPENCODE_PROVIDER_DEFINITIONS } from "./provider/definitions";
import { formatUsageStatus, formatUsageTooltip } from "./usage/presentation";
import type { OpenCodeUsageSnapshot } from "./usage/domain";
import { activeConsoleProfileFromState } from "./provider-profile";
import { isNewerVersion, parseExtensionRelease, RELEASES_LATEST_API_URL } from "./updates/releases";

const LEGACY_USAGE_STATE_KEY = "opencode.usageSnapshot.v1";
const USAGE_STATE_KEY = "opencode.usageSnapshots.v2";
const ACTIVE_CONSOLE_PROFILE_STATE_KEY = "opencode.activeConsoleProfile.v1";
const RELEASE_CHECKED_AT_STATE_KEY = "opencode.releaseCheckedAt.v1";
const RELEASE_NOTIFIED_TAG_STATE_KEY = "opencode.releaseNotifiedTag.v1";
const RELEASE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode");
  const auth = new OpenCodeAuth(context.secrets);
  const version = context.extension.packageJSON.version as string;
  const userAgent = `opencode-copilot-chat/${version} VSCode/${vscode.version}`;
  const initialUsage = context.globalState.get<Readonly<Record<string, OpenCodeUsageSnapshot>>>(USAGE_STATE_KEY)
    ?? { "zen:legacy": context.globalState.get<OpenCodeUsageSnapshot>(LEGACY_USAGE_STATE_KEY) ?? {} };
  const activeConsoleProfile = activeConsoleProfileFromState(context.globalState.get<unknown>(ACTIVE_CONSOLE_PROFILE_STATE_KEY));
  const metadata = new ModelsDevMetadata(context.globalState);
  const providers = Object.fromEntries(Object.values(OPENCODE_PROVIDER_DEFINITIONS).map((definition) => [
    definition.mode,
    new OpenCodeProvider(
      auth,
      output,
      userAgent,
      definition.mode,
      () => new ModelCatalog(fetch, context.globalState, metadata),
      initialUsage,
      definition.mode === "console" ? activeConsoleProfile : undefined,
    ),
  ])) as Record<keyof typeof OPENCODE_PROVIDER_DEFINITIONS, OpenCodeProvider>;
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  usageStatus.name = "OpenCode usage";
  usageStatus.command = "opencodeCopilot.showUsage";
  renderUsageStatus(usageStatus, providers.zen.getUsageSnapshot());
  updateUsageStatusVisibility(usageStatus);
  let activeUsageProvider = providers.zen;
  context.subscriptions.push(
    output,
    usageStatus,
    providers.console.onDidChangeActiveConsoleProfile((profile) => {
      void context.globalState.update(ACTIVE_CONSOLE_PROFILE_STATE_KEY, profile);
    }),
    ...Object.values(providers).map((provider) => provider.onDidChangeUsage(({ scope, usage }) => {
      if (scope === provider.getActiveScope()) {
        activeUsageProvider = provider;
        renderUsageStatus(usageStatus, usage);
      }
      updateUsageStatusVisibility(usageStatus);
      void context.globalState.update(USAGE_STATE_KEY, Object.assign(
        {},
        ...Object.values(providers).map((item) => item.getUsageSnapshots()),
      ));
    })),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("opencode.freeOnly")) providers.zen.fireDidChange();
      if (event.affectsConfiguration("opencode.reasoningEffort")
        || event.affectsConfiguration("opencode.thinking")
        || event.affectsConfiguration("opencode.maxOutputTokens")
        || event.affectsConfiguration("opencode.catalogCacheMinutes")) {
        for (const provider of Object.values(providers)) provider.fireDidChange();
      }
      if (event.affectsConfiguration("opencode.showUsageStatusBar")) updateUsageStatusVisibility(usageStatus);
    }),
    ...Object.values(OPENCODE_PROVIDER_DEFINITIONS).map((definition) =>
      vscode.lm.registerLanguageModelChatProvider(definition.vendor, providers[definition.mode])),
    ...registerCommands(auth, providers, output, () => activeUsageProvider),
    registerInlineCompletions(context, {
      resolveApiKey: async (gateway) => (await auth.getApiKeys())[gateway],
      output,
      userAgent,
    }),
  );
  const releaseTimer = setInterval(() => void checkForRelease(context, version, userAgent, output), RELEASE_CHECK_INTERVAL_MS);
  context.subscriptions.push(new vscode.Disposable(() => clearInterval(releaseTimer)));
  void checkForRelease(context, version, userAgent, output);
  output.appendLine(`[activate] OpenCode for Copilot Chat ${version} on VS Code ${vscode.version}`);
  void auth.importLocalConsoleSession().then((session) => {
    if (!session) return;
    output.appendLine("[auth] imported a local OpenCode Console session into VS Code Secret Storage");
    providers.console.fireDidChange();
  }).catch((error) => output.appendLine(`[auth] local OpenCode database import failed: ${messageOf(error)}`));
}

async function checkForRelease(
  context: vscode.ExtensionContext,
  currentVersion: string,
  userAgent: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const checkedAt = context.globalState.get<number>(RELEASE_CHECKED_AT_STATE_KEY) ?? 0;
  if (Date.now() - checkedAt < RELEASE_CHECK_INTERVAL_MS) return;
  await context.globalState.update(RELEASE_CHECKED_AT_STATE_KEY, Date.now());
  try {
    const response = await fetch(RELEASES_LATEST_API_URL, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": userAgent, "X-GitHub-Api-Version": "2022-11-28" },
    });
    if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status}`);
    const release = parseExtensionRelease(await response.json());
    if (!release || !isNewerVersion(release.version, currentVersion)) return;
    if (context.globalState.get<string>(RELEASE_NOTIFIED_TAG_STATE_KEY) === release.tag) return;
    await context.globalState.update(RELEASE_NOTIFIED_TAG_STATE_KEY, release.tag);
    const action = await vscode.window.showInformationMessage(
      `OpenCode for Copilot Chat ${release.version} is available. Download the VSIX, then use Extensions → … → Install from VSIX… to update.`,
      "View Release",
    );
    if (action === "View Release") await vscode.env.openExternal(vscode.Uri.parse(release.pageUrl));
  } catch (error) {
    output.appendLine(`[updates] daily GitHub release check failed: ${messageOf(error)}`);
  }
}

function renderUsageStatus(item: vscode.StatusBarItem, snapshot: OpenCodeUsageSnapshot): void {
  item.text = formatUsageStatus(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("opencode").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}
