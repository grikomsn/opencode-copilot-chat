import type { OpenCodeUsageSnapshot } from "./domain";

export interface UsageDisplayRow {
  kind: "tracked" | "request" | "empty";
  label: string;
  description: string;
  detail?: string;
}

export function formatUsageStatus(snapshot: OpenCodeUsageSnapshot): string {
  if (snapshot.tracked?.totalTokens) return `$(pulse) OpenCode ${compactCount(snapshot.tracked.totalTokens)} tokens`;
  if (snapshot.totalTokens) return `$(symbol-numeric) OpenCode ${compactCount(snapshot.totalTokens)} tokens`;
  return "$(cloud) OpenCode";
}

export function formatUsageTooltip(snapshot: OpenCodeUsageSnapshot): string {
  const lines = ["OpenCode usage"];
  if (snapshot.tracked) lines.push(`Tracked locally: ${snapshot.tracked.totalTokens.toLocaleString()} tokens across ${snapshot.tracked.requests.toLocaleString()} requests`);
  if (snapshot.model) lines.push(`Last model: ${snapshot.model}`);
  if (snapshot.inputTokens !== undefined || snapshot.outputTokens !== undefined) lines.push(`Last request: ${(snapshot.inputTokens ?? 0).toLocaleString()} input · ${(snapshot.outputTokens ?? 0).toLocaleString()} output`);
  if (snapshot.updatedAt) lines.push(`Updated: ${new Date(snapshot.updatedAt).toLocaleString()}`);
  else lines.push("No inference usage has been reported yet");
  lines.push("Click for details");
  return lines.join("\n");
}

export function formatUsageRows(snapshot: OpenCodeUsageSnapshot): UsageDisplayRow[] {
  const rows: UsageDisplayRow[] = [];
  if (snapshot.tracked) rows.push({
    kind: "tracked",
    label: "Tracked by this extension",
    description: `${snapshot.tracked.totalTokens.toLocaleString()} tokens across ${snapshot.tracked.requests.toLocaleString()} requests`,
    detail: `${snapshot.tracked.inputTokens.toLocaleString()} input · ${snapshot.tracked.outputTokens.toLocaleString()} output`,
  });
  if (snapshot.model) rows.push({
    kind: "request",
    label: "Last inference",
    description: `${(snapshot.totalTokens ?? 0).toLocaleString()} tokens`,
    detail: `${snapshot.model} · ${(snapshot.inputTokens ?? 0).toLocaleString()} input · ${(snapshot.outputTokens ?? 0).toLocaleString()} output`,
  });
  if (!rows.length) rows.push({ kind: "empty", label: "No usage observed yet", description: "Send an OpenCode request to begin local tracking" });
  return rows;
}

function compactCount(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
  return value.toLocaleString();
}
