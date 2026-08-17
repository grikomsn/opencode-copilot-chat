# Credential handling

Zen and Go API keys are stored separately in VS Code Secret Storage. Console sessions are also managed in Secret Storage. When no VS Code-managed Console session exists, the extension can read the active account from `~/.local/share/opencode/opencode.db` and import it once. The database is always opened read-only; device sign-in, token refresh, organization selection, and sign-out never modify it.

The output channel records only status and metadata. It does not record API keys, access tokens, refresh tokens, prompts, response text, or account data.
