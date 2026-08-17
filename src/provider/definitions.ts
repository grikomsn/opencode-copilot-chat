import type { OpenCodeMode } from "../transport/protocol";

export interface OpenCodeProviderDefinition {
  readonly mode: OpenCodeMode;
  readonly vendor: string;
  readonly displayName: string;
  readonly managementCommand: string;
}

export const OPENCODE_PROVIDER_DEFINITIONS: Readonly<Record<OpenCodeMode, OpenCodeProviderDefinition>> = {
  zen: {
    mode: "zen",
    vendor: "opencodezen",
    displayName: "OpenCode Zen",
    managementCommand: "opencodeCopilot.manageZen",
  },
  go: {
    mode: "go",
    vendor: "opencodego",
    displayName: "OpenCode Go",
    managementCommand: "opencodeCopilot.manageGo",
  },
  console: {
    mode: "console",
    vendor: "opencodeconsole",
    displayName: "OpenCode Console",
    managementCommand: "opencodeCopilot.manageConsole",
  },
};

export function providerDefinition(mode: OpenCodeMode): OpenCodeProviderDefinition {
  return OPENCODE_PROVIDER_DEFINITIONS[mode];
}
