import * as vscode from "vscode";
import { registerInlineCompletions } from "./autocomplete";
import { DEFAULT_CONSOLE_PROFILE } from "./auth/auth";
import { INLINE_SUGGESTIONS_ACCOUNT_SETTING } from "./autocomplete/config";
import { OpenCodeAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { OpenCodeProvider } from "./provider";
import { ModelCatalog } from "./models/catalog";
import { ModelsDevMetadata } from "./models/metadata";
import { OPENCODE_PROVIDER_DEFINITIONS } from "./provider/definitions";
import { formatUsageStatus, formatUsageTooltip } from "./usage/presentation";
import type { OpenCodeUsageSnapshot } from "./usage/domain";
import { activeConsoleProfileFromState } from "./provider-profile";

const LEGACY_USAGE_STATE_KEY = "opencode.usageSnapshot.v1";
const USAGE_STATE_KEY = "opencode.usageSnapshots.v2";
const ACTIVE_CONSOLE_PROFILE_STATE_KEY = "opencode.activeConsoleProfile.v1";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode");
  const auth = new OpenCodeAuth(context.secrets);
  const version = context.extension.packageJSON.version as string;
  const userAgent = `opencode-copilot-chat/${version} VSCode/${vscode.version}`;
  // Versions before the Console transition tracked usage under `zen:*` scopes;
  // those snapshots are migrated to `console:*` and shown for the Console
  // provider's legacy credential scope.
  const legacyUsage = context.globalState.get<Readonly<Record<string, OpenCodeUsageSnapshot>>>(USAGE_STATE_KEY);
  const migratedUsage = legacyUsage
    ? Object.fromEntries(Object.entries(legacyUsage).map(([scope, usage]) => [migrateUsageScope(scope), usage]))
    : { "console:legacy": context.globalState.get<OpenCodeUsageSnapshot>(LEGACY_USAGE_STATE_KEY) ?? {} };
  const initialUsage = migratedUsage;
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
  renderUsageStatus(usageStatus, providers.console.getUsageSnapshot());
  updateUsageStatusVisibility(usageStatus);
  let activeUsageProvider = providers.console;
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
      if (event.affectsConfiguration("opencode.freeOnly")) providers.console.fireDidChange();
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
      resolveApiKey: async (gateway) => {
        const account = vscode.workspace.getConfiguration("opencode").get<string>(INLINE_SUGGESTIONS_ACCOUNT_SETTING, DEFAULT_CONSOLE_PROFILE);
        return (await auth.getAccountKeys(account || DEFAULT_CONSOLE_PROFILE))[gateway];
      },
      output,
      userAgent,
    }),
  );
  output.appendLine(`[activate] OpenCode Bridge for Copilot Chat ${version} on VS Code ${vscode.version}`);
}

function renderUsageStatus(item: vscode.StatusBarItem, snapshot: OpenCodeUsageSnapshot): void {
  item.text = formatUsageStatus(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("opencode").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}

/** Maps pre-Console usage scopes (`zen:*`) onto Console equivalents. */
function migrateUsageScope(scope: string): string {
  return scope === "zen:legacy" ? "console:legacy" : scope.replace(/^zen:/, "console:");
}
