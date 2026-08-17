# Setup

Run `OpenCode: Manage Connection` from the VS Code Command Palette. You can also manage each model group directly with `OpenCode Zen: Manage Connection`, `OpenCode Go: Manage Connection`, or `OpenCode Console: Manage Connection`.

- Zen and Go accept the API keys from their OpenCode account pages.
- Console opens the device verification URL, polls the standard OpenCode Console token endpoint, and asks you to select an organization.
- **OpenCode Console: Import Local Session** performs a read-only, one-way import from the active account in local `opencode.db` when that file and schema are available.

Zen, Go, and Console are always registered as separate model-provider groups. `opencode.defaultMode` only chooses the group targeted by generic connection, refresh, and test commands; it does not hide either of the other groups. Console model discovery is organization-scoped and is read from `/api/config` with `x-org-id`; models marked `disabled` in that response are excluded.
After device sign-in or local import, VS Code Secret Storage is authoritative. Token refreshes, organization changes, and sign-out do not read from or write to `opencode.db`. Automatic import is attempted only when VS Code has never managed or signed out a Console session; after sign-out, use the explicit import command to import again. If the organization config is unavailable, no Console models are shown.

Reasoning-capable models show a **Thinking** or **Thinking Effort** submenu in the Copilot Chat model picker. The extension derives the choices from OpenCode's live `reasoning_options` metadata when available and maps the selected value to the request format required by that model family. Qwen models can also expose a separate thinking-token budget control.

For Zen and Go, a signed-in refresh treats the account's `/models` response as authoritative and fills omitted fields from the canonical `opencode` or `opencode-go` provider in models.dev. Zen and Go share one six-hour, stale-while-revalidate metadata snapshot in VS Code `globalState`. The last successful live result is cached for up to 24 hours under a credential-scoped key; Console configuration is never persisted in that public cache. Request limits reserve context headroom, and only rejected optional parameters or transient 502–504/router failures are retried.

Use **OpenCode: Show Usage** or click the status-bar indicator to inspect inference tokens accumulated across Zen, Go, and Console. **OpenCode: Test Connection** sends a small live request through the group selected by `opencode.defaultMode`; **OpenCode: Refresh Models** refreshes that group's catalog. `opencode.catalogCacheMinutes` controls normal live-catalog freshness, while `opencode.requestTimeoutSeconds` and `opencode.streamIdleTimeoutSeconds` bound total request time and stalled streams separately. Secret-safe request metadata can be enabled with `opencode.debugLogging`.
