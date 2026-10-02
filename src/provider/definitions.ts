import type { OpenCodeMode } from "../transport/protocol";

export interface OpenCodeProviderDefinition {
  readonly mode: OpenCodeMode;
  readonly vendor: string;
  readonly displayName: string;
}

export const OPENCODE_PROVIDER_DEFINITIONS: Readonly<Record<OpenCodeMode, OpenCodeProviderDefinition>> = {
  console: {
    mode: "console",
    vendor: "opencodeconsole",
    displayName: "OpenCode Console",
  },
  go: {
    mode: "go",
    vendor: "opencodego",
    displayName: "OpenCode Go",
  },
};

export function providerDefinition(mode: OpenCodeMode): OpenCodeProviderDefinition {
  return OPENCODE_PROVIDER_DEFINITIONS[mode];
}
