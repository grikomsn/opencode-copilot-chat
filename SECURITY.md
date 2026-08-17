# Security

Report security issues privately to the repository maintainers rather than opening a public issue with credentials, OAuth artifacts, or captured prompts.

The extension stores API keys and Console tokens in VS Code Secret Storage. Console sign-in also synchronizes the account to the standard local OpenCode SQLite database so the official CLI can use the same account. Tokens and prompts are never written to logs.
