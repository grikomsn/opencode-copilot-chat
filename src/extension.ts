import * as vscode from "vscode";
import { OpenCodeAuth } from "./auth/auth";
import { registerCommands } from "./commands/commands";
import { messageOf } from "./errors";
import { OpenCodeProvider } from "./provider";
import { ModelCatalog } from "./models/catalog";
import { ModelsDevMetadata } from "./models/metadata";
import { OPENCODE_PROVIDER_DEFINITIONS } from "./provider/definitions";
import { formatUsageStatus, formatUsageTooltip } from "./usage/presentation";
import type { OpenCodeUsageSnapshot } from "./usage/domain";
import { OpenCodeUsageStore } from "./usage/store";

const USAGE_STATE_KEY = "opencode.usageSnapshot.v1";

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("OpenCode");
  const auth = new OpenCodeAuth(context.secrets);
  const version = context.extension.packageJSON.version as string;
  const userAgent = `opencode-copilot-chat/${version} VSCode/${vscode.version}`;
  const initialUsage = context.globalState.get<OpenCodeUsageSnapshot>(USAGE_STATE_KEY) ?? {};
  const usageStore = new OpenCodeUsageStore(initialUsage);
  const metadata = new ModelsDevMetadata(context.globalState);
  const catalog = new ModelCatalog(fetch, context.globalState, metadata);
  const providers = Object.fromEntries(Object.values(OPENCODE_PROVIDER_DEFINITIONS).map((definition) => [
    definition.mode,
    new OpenCodeProvider(auth, output, userAgent, definition.mode, catalog, usageStore),
  ])) as Record<keyof typeof OPENCODE_PROVIDER_DEFINITIONS, OpenCodeProvider>;
  const usageStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 90);
  usageStatus.name = "OpenCode usage";
  usageStatus.command = "opencodeCopilot.showUsage";
  renderUsageStatus(usageStatus, initialUsage);
  updateUsageStatusVisibility(usageStatus);
  context.subscriptions.push(
    output,
    usageStatus,
    usageStore,
    usageStore.onDidChange((usage) => {
      renderUsageStatus(usageStatus, usage);
      updateUsageStatusVisibility(usageStatus);
      void context.globalState.update(USAGE_STATE_KEY, usage);
    }),
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
    ...registerCommands(auth, providers, output),
  );
  output.appendLine(`[activate] OpenCode for Copilot Chat ${version} on VS Code ${vscode.version}`);
  void auth.importLocalConsoleSession().then((session) => {
    if (!session) return;
    output.appendLine("[auth] imported a local OpenCode Console session into VS Code Secret Storage");
    providers.console.fireDidChange();
  }).catch((error) => output.appendLine(`[auth] local OpenCode database import failed: ${messageOf(error)}`));
}

function renderUsageStatus(item: vscode.StatusBarItem, snapshot: OpenCodeUsageSnapshot): void {
  item.text = formatUsageStatus(snapshot);
  item.tooltip = formatUsageTooltip(snapshot);
}

function updateUsageStatusVisibility(item: vscode.StatusBarItem): void {
  if (vscode.workspace.getConfiguration("opencode").get("showUsageStatusBar", true)) item.show();
  else item.hide();
}
