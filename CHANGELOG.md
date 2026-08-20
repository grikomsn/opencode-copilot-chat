# Changelog

## 0.4.0

### Minor Changes

- 7a43924: Support multiple native Zen and Go API-key entries plus isolated named OpenCode Console OAuth profiles, catalogs, refresh state, organizations, and usage snapshots.

## 0.3.1

### Patch Changes

- 393f13b: Align the README, package metadata, and lockfile identity with the extension's provider groups, image-input support, discovery keywords, and model-specific thinking controls.

## 0.3.0

### Minor Changes

- 678a3ae: Publish OpenCode under its unique Marketplace identity with the same release metadata and documentation conventions as the sibling providers.

## 0.2.0

### Minor Changes

- 94e17ab: Add OpenCode Zen, OpenCode Go, and OpenCode Console authentication and model discovery for Copilot Chat.

### Patch Changes

- 94e17ab: Add shared cross-group usage tracking and status details, a live connection test, configurable catalog freshness, and secret-safe diagnostics and debug logging.
- 94e17ab: Remove redundant provider labels from the VS Code model picker.
- 94e17ab: Add native per-model Thinking Effort and Qwen budget controls, preserve multi-turn reasoning and tool identity, sanitize tool schemas, report native usage, budget context safely, cache authenticated catalogs, and retry recoverable provider failures.
- 94e17ab: Filter disabled OpenCode Console models from the VS Code model picker.
- 94e17ab: Make authenticated OpenCode model discovery authoritative and enrich Zen and Go models with one shared, persisted models.dev metadata snapshot.
- 94e17ab: Group OpenCode Zen, Go, and Console models separately in the Copilot Chat picker and align Kimi and MiniMax thinking payloads with OpenCode.
- 94e17ab: Show model thinking-effort controls in the Copilot Chat composer even when an OpenCode Console catalog omits reasoning capability metadata, and align Qwen budgets, generic reasoning fallbacks, Kimi K2.7 labeling, legacy picker fields, and per-family defaults with the upstream OpenCode provider.
- 94e17ab: Default ordered OpenCode reasoning controls to High, binary thinking controls to On, and provider-managed Qwen thinking to Auto.
- 94e17ab: Make VS Code Secret Storage authoritative for Console authentication and limit local opencode.db integration to an optional read-only, one-way session import.

All notable changes to this project will be documented in this file.
