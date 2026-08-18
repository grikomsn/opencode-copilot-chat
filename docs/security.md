# Credential handling

Zen and Go API keys added through **Manage Language Models** are marked as secret provider configuration, so VS Code stores every entry securely. The extension places only a short SHA-256-derived reference in model metadata and local usage state. The older command-managed Zen and Go defaults remain in Secret Storage for migration and development workflows.

Console access and refresh tokens are stored per named profile in VS Code Secret Storage, with separate refresh locks and organization selection. When no VS Code-managed default Console session exists, the extension can read the active account from `~/.local/share/opencode/opencode.db` and import it once. The database is always opened read-only; device sign-in, token refresh, organization selection, and sign-out never modify it.

The output channel records only status and metadata. It does not record API keys, access tokens, refresh tokens, prompts, response text, or account data.
