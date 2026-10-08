#!/usr/bin/env node
// Model-metadata resync helper for the OpenCode bridge.
// Probes the anonymous Zen and Go /models endpoints plus the public models.dev
// catalog, diffs them against the bundled supplemental mirrors, and re-mirrors
// mirror entries whose canonical upstream catalog entry now exists (mirrors
// only ever copy data a canonical entry already publishes; nothing is guessed).
// Routing heuristics, thinking families, display names, and pruning decisions
// are reported for manual review.
//
// Usage:
//   npm run refresh-models                              # report only
//   node scripts/refresh-models.mjs --apply             # re-mirror canonical data
//   node scripts/refresh-models.mjs --pr                # --apply + branch/push/PR
//   node scripts/refresh-models.mjs --ci --report-file model-resync-report.md

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const METADATA_FILE = path.join(ROOT, "src/models/metadata.ts");
const SUPPLEMENTAL_START = 'const SUPPLEMENTAL_MODELS: Readonly<Record<"opencode" | "opencode-go", Readonly<Record<string, ModelSource>>>> = {\n';
const SUPPLEMENTAL_END = "};\n";
const ALIAS_START = "export const ALIAS_MODELS: Readonly<Record<\"opencode\" | \"opencode-go\", Readonly<Record<string, string>>>> = {\n";
const ALIAS_END = "};\n";
const CHANGESET_SUMMARY = "Resync supplemental model mirrors with current models.dev metadata.";
const MODELS_DEV_URL = "https://models.dev/api.json";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") || argv.includes("--pr") || argv.includes("--ci");
const CREATE_PR = argv.includes("--pr");
const reportFileIdx = argv.indexOf("--report-file");
const reportPath = reportFileIdx >= 0 ? argv[reportFileIdx + 1] : undefined;
const require_ = createRequire(import.meta.url);

const report = [];
function log(line = "") {
  report.push(line);
  console.log(line);
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

function requireBundled() {
  const resolved = path.join(ROOT, "out", "models/metadata.js");
  if (!existsSync(resolved) || srcNewerThan(resolved)) {
    const compiled = spawnSync("npm", ["run", "compile"], { cwd: ROOT, encoding: "utf8" });
    if (compiled.status) {
      console.error(compiled.stderr);
      process.exit(compiled.status ?? 1);
    }
  }
  return require_(resolved);
}

/** True when any TypeScript source is newer than the compiled target. */
function srcNewerThan(target) {
  const compiled = statSync(target).mtimeMs;
  const stack = [path.join(ROOT, "src")];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (/\.(?:ts|mts)$/.test(entry.name) && statSync(full).mtimeMs > compiled) return true;
    }
  }
  return false;
}

function envKey(name) {
  const fromEnvironment = process.env[name]?.trim();
  if (fromEnvironment) return fromEnvironment;
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return undefined;
  const match = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  const value = match?.[1]?.trim();
  return value || undefined;
}

function isInternalTestModel(id) {
  return /^test(?:[-_.]|$)/i.test(id.trim());
}

/** Parses the supplemental-mirrors region into per-provider entry spans. */
function parseSupplemental() {
  const source = readFileSync(METADATA_FILE, "utf8");
  const start = source.indexOf(SUPPLEMENTAL_START);
  if (start < 0) throw new Error("SUPPLEMENTAL_MODELS region not found in metadata.ts");
  const bodyStart = start + SUPPLEMENTAL_START.length;
  const end = source.indexOf(SUPPLEMENTAL_END, bodyStart);
  if (end < 0) throw new Error("SUPPLEMENTAL_MODELS terminator not found in metadata.ts");
  const text = source.slice(bodyStart, end);
  const providerSpans = [];
  for (const provider of ["opencode", "opencode-go"]) {
    const marker = provider === "opencode" ? "  opencode: {\n" : '  "opencode-go": {\n';
    const from = text.indexOf(marker);
    const to = from >= 0 ? text.indexOf("\n  },", from) : -1;
    if (from < 0 || to < 0) throw new Error(`${provider} group not found in SUPPLEMENTAL_MODELS`);
    providerSpans.push({ provider, from: from + marker.length, to });
  }
  const entries = [];
  for (const { provider, from, to } of providerSpans) {
    const group = text.slice(from, to);
    const lines = group.split("\n");
    let entry = null;
    let depth = 0;
    let entryStart = -1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (entry === null) {
        const key = line.match(/^    "([^"]+)": \{/);
        if (key) {
          entry = key[1];
          entryStart = index;
          depth = 1;
        }
      } else {
        const opens = (line.match(/\{/g) ?? []).length;
        const closes = (line.match(/\}/g) ?? []).length;
        depth += opens - closes;
        if (depth === 0) {
          entries.push({
            provider,
            key: entry,
            startOffset: from + lines.slice(0, entryStart).join("\n").length + (entryStart > 0 ? 1 : 0),
            raw: `${lines.slice(entryStart, index + 1).join("\n")}\n`,
          });
          entry = null;
        }
      }
    }
  }
  return { source, regionStart: bodyStart, entries };
}

function fmtNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  if (Number.isSafeInteger(value) && Math.abs(value) >= 10_000) {
    const digits = String(value);
    return digits.replace(/\B(?=(\d{3})+(?!\d))/g, "_");
  }
  return value;
}

/** Serializes one ModelSource mirror entry from a models.dev canonical entry. */
function serializeMirror(key, canonical) {
  const rows = [];
  rows.push(`      id: "${key}",`);
  if (canonical.name) rows.push(`      name: ${JSON.stringify(canonical.name)},`);
  if (canonical.family) rows.push(`      family: ${JSON.stringify(canonical.family)},`);
  const limit = canonical.limit ?? {};
  if (limit.context != null || limit.input != null || limit.output != null) {
    const parts = [];
    if (limit.context != null) parts.push(`context: ${fmtNumber(limit.context)}`);
    if (limit.input != null) parts.push(`input: ${fmtNumber(limit.input)}`);
    if (limit.output != null) parts.push(`output: ${fmtNumber(limit.output)}`);
    rows.push(`      limit: { ${parts.join(", ")} },`);
  }
  if (canonical.reasoning === true) rows.push(`      reasoning: true,`);
  if (Array.isArray(canonical.reasoning_options)) {
    const options = canonical.reasoning_options.map((option) => {
      const fields = [`type: ${JSON.stringify(option.type)}`];
      if (Array.isArray(option.values) && option.values.length) {
        fields.push(`values: [${option.values.map((value) => JSON.stringify(value)).join(", ")}]`);
      }
      if (option.min != null) fields.push(`min: ${option.min}`);
      if (option.max != null) fields.push(`max: ${fmtNumber(option.max)}`);
      return `{ ${fields.join(", ")} }`;
    });
    rows.push(`      reasoning_options: [${options.join(", ")}],`);
  }
  if (canonical.tool_call === true) rows.push(`      tool_call: true,`);
  if (canonical.attachment === true) rows.push(`      attachment: true,`);
  if (Array.isArray(canonical.modalities?.input) && canonical.modalities.input.length) {
    rows.push(`      modalities: { input: [${canonical.modalities.input.map((value) => JSON.stringify(value)).join(", ")}] },`);
  }
  if (canonical.provider?.npm) rows.push(`      provider: { npm: ${JSON.stringify(canonical.provider.npm)} },`);
  const cost = canonical.cost;
  if (cost && cost.input != null && cost.output != null) {
    const parts = [`input: ${cost.input}`, `output: ${cost.output}`];
    if (cost.cache_read != null) parts.push(`cache_read: ${cost.cache_read}`);
    rows.push(`      cost: { ${parts.join(", ")} },`);
  }
  return `    "${key}": {\n${rows.join("\n")}\n    },\n`;
}

const main = async () => {
  const apiKey = envKey("OPENCODE_API_KEY");
  const [zen, go, modelsDev] = await Promise.all([
    fetchJson("https://opencode.ai/zen/v1/models"),
    fetchJson("https://opencode.ai/zen/go/v1/models"),
    fetchJson(MODELS_DEV_URL, { headers: { accept: "application/json" } }),
  ]);
  const liveIds = (payload) => new Set((payload.data ?? payload)
    .map((model) => model?.id)
    .filter((id) => typeof id === "string" && !isInternalTestModel(id)));
  const live = new Map([
    ["opencode", liveIds(zen)],
    ["opencode-go", liveIds(go)],
  ]);
  if (apiKey) {
    // Authenticated discovery is what signed-in users see; union it with the
    // anonymous lists so ids served only to authenticated accounts are also
    // considered. A failed authenticated probe is non-fatal: anonymous
    // discovery remains the baseline.
    try {
      const [zenAuth, goAuth] = await Promise.all([
        fetchJson("https://opencode.ai/zen/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } }),
        fetchJson("https://opencode.ai/zen/go/v1/models", { headers: { Authorization: `Bearer ${apiKey}` } }),
      ]);
      for (const [provider, payload] of [["opencode", zenAuth], ["opencode-go", goAuth]]) {
        const union = new Set([...live.get(provider), ...liveIds(payload)]);
        live.set(provider, union);
      }
    } catch (error) {
      log(`WARNING: authenticated discovery probe failed (${error instanceof Error ? error.message : error}); continuing with anonymous lists.`);
    }
  }
  log(`Live discovery: ${live.get("opencode").size} Console ids, ${live.get("opencode-go").size} Go ids${apiKey ? " (anonymous + authenticated)" : ""}`);

  const canonical = { opencode: modelsDev.opencode?.models ?? {}, "opencode-go": modelsDev["opencode-go"]?.models ?? {} };
  log(`models.dev: ${Object.keys(canonical.opencode).length} Console models, ${Object.keys(canonical["opencode-go"]).length} Go models`);

  const { source, regionStart, entries } = parseSupplemental();
  const dead = [];
  const liveOnly = [];
  const remirrored = [];
  for (const entry of entries) {
    const canonicalEntries = [canonical[entry.provider], canonical[entry.provider === "opencode" ? "opencode-go" : "opencode"]];
    const canonicalEntry = canonicalEntries.find((models) => models[entry.key]?.cost?.input != null || models[entry.key]?.limit?.context != null);
    if (!canonicalEntry?.[entry.key]) {
      const isLive = live.get(entry.provider).has(entry.key);
      (isLive ? liveOnly : dead).push(`${entry.provider}/${entry.key}`);
      continue;
    }
    const fresh = serializeMirror(entry.key, canonicalEntry[entry.key]);
    if (fresh !== entry.raw) {
      remirrored.push(entry.key);
      entry.next = fresh;
    }
  }
  if (liveOnly.length) log(`Discovery-only ids models.dev has not cataloged (manual review; mirrors are only re-synced from upstream): ${liveOnly.join(", ") || "none"}`);
  if (dead.length) log(`Mirrors with id neither live nor models.dev-cataloged (kept as-is): ${dead.join(", ") || "none"}`);
  if (remirrored.length) log(`Re-mirrored from models.dev canonicals: ${remirrored.join(", ")}`);
  if (!remirrored.length) log("No mirror drift; supplemental entries already match upstream.");

  const changedFiles = [];
  if (APPLY && remirrored.length) {
    let updated = source;
    // Apply from the last entry backward so every recorded offset stays valid.
    for (const entry of [...entries].reverse()) {
      if (!entry.next) continue;
      updated = updated.slice(0, regionStart + entry.startOffset) + entry.next + updated.slice(regionStart + entry.startOffset + entry.raw.length);
    }
    writeFileSync(METADATA_FILE, updated);
    changedFiles.push("src/models/metadata.ts", writeChangeset());
    log(`Applied updates to: ${changedFiles.join(", ")}`);
  }

  if (CREATE_PR) await createPullRequest(changedFiles);
};

function writeChangeset() {
  const date = new Date().toISOString().slice(0, 10);
  const file = path.join(ROOT, ".changeset", `resync-model-metadata-${date}.md`);
  const body = `---\n"opencode-bridge-for-copilot-chat": patch\n---\n\n${CHANGESET_SUMMARY}\n`;
  if (!existsSync(file) || readFileSync(file, "utf8") !== body) writeFileSync(file, body);
  return path.relative(ROOT, file);
}

async function createPullRequest(changedFiles) {
  if (!changedFiles.length) {
    log("No drift to commit; skipping PR.");
    return;
  }
  const run = (name, args) => {
    const result = spawnSync(name, args, { cwd: ROOT, encoding: "utf8" });
    if (result.status) throw new Error(`${name} ${args.join(" ")} failed:\n${result.stderr}`);
    return result.stdout.trim();
  };
  const date = new Date().toISOString().slice(0, 10);
  const branch = `resync/models-${date}`;
  if (run("git", ["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") {
    throw new Error("--pr must run from a clean checkout of main");
  }
  run("git", ["checkout", "-b", branch]);
  run("git", ["add", "--", ...changedFiles]);
  run("git", ["commit", "-m", "Resync model metadata"]);
  run("git", ["push", "-u", "origin", branch]);
  const bodyPath = path.join(process.env.TMPDIR ?? "/tmp", `opencode-bridge-${process.pid}-resync-pr.md`);
  writeFileSync(bodyPath, `${report.join("\n")}\n`);
  const created = spawnSync(
    "gh",
    ["pr", "create", "--head", branch, "--base", "main", "--title", "Resync model metadata from live sources", "--body-file", bodyPath],
    { cwd: ROOT, encoding: "utf8" },
  );
  log(created.stdout.trim() || created.stderr.trim());
  run("git", ["checkout", "main"]);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

if (reportPath) {
  writeFileSync(reportPath, `${report.join("\n")}\n`);
}
