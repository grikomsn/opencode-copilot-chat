# Setup

Open **Manage Language Models** and use **Add Models** for each OpenCode entry you want:

- Zen and Go accept an API key directly in the native provider form. VS Code stores the field as a secret. Add another named entry to use another account or key.
- Console first requires **OpenCode: Add Console Account**. Choose a profile ID, complete device authorization and organization selection, then enter the same profile ID when adding the native Console provider entry.
- **OpenCode: Select Active Console Profile** chooses the profile targeted by usage and management commands.
- **OpenCode Console: Import Local Session** performs a read-only, one-way import from the active account in local `opencode.db` when that file and schema are available.

Zen, Go, and Console remain separate providers, and each provider can now have multiple named entries. `opencode.defaultMode` only chooses the provider targeted by generic legacy connection, refresh, and test commands; it does not hide other entries. Console model discovery is profile- and organization-scoped and is read from `/api/config` with `x-org-id`; models marked `disabled` in that response are excluded.
After device sign-in or local import, VS Code Secret Storage is authoritative. Token refreshes, organization changes, and sign-out do not read from or write to `opencode.db`. Automatic import is attempted only when VS Code has never managed or signed out a Console session; after sign-out, use the explicit import command to import again. If the organization config is unavailable, no Console models are shown.

Reasoning-capable models show a **Thinking** or **Thinking Effort** submenu in the Copilot Chat model picker. The extension derives the choices from OpenCode's live `reasoning_options` metadata when available and maps the selected value to the request format required by that model family. Qwen models can also expose a separate thinking-token budget control.

For Zen and Go, a signed-in refresh treats the account's `/models` response as authoritative and fills omitted fields from the canonical `opencode` or `opencode-go` provider in models.dev. Zen and Go share one six-hour, stale-while-revalidate metadata snapshot in VS Code `globalState`. The last successful live result is cached for up to 24 hours under a credential-scoped key; Console configuration is never persisted in that public cache. Request limits reserve context headroom, and only rejected optional parameters or transient 502–504/router failures are retried.

Use **OpenCode: Show Usage** or click the status-bar indicator to inspect inference tokens for the most recently used provider entry. Usage snapshots and catalogs remain isolated by API-key fingerprint or Console profile. **OpenCode: Test Connection** and **OpenCode: Refresh Models** target the active entry of the provider selected by `opencode.defaultMode`. `opencode.catalogCacheMinutes` controls normal live-catalog freshness, while `opencode.requestTimeoutSeconds` and `opencode.streamIdleTimeoutSeconds` bound total request time and stalled streams separately. Secret-safe request metadata can be enabled with `opencode.debugLogging`.
