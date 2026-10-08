---
"opencode-bridge-for-copilot-chat": minor
---

Account separation across OpenCode providers, with a simpler split of
responsibilities. The extension now manages only OpenCode Console
device-code accounts (named profiles): one signed-in session token
authenticates both the Console and Go gateways, so a Go entry can reference
a different account by profile, or both gateways can share one account.
Service-account keys are never stored by the extension; command-managed
key sign-ins are removed and keys stay user-managed in VS Code provider
entries (with an optional stable entry label that keeps model IDs and usage
scopes stable across key rotation).
Model IDs are now qualified per credential so multiple entries of one vendor
cannot collide; the default Console device profile and the command-managed Go
credential keep unqualified IDs for compatibility with earlier model selections.
Signed-out sessions no longer race credential refreshes, 401 retries only
refresh session-backed credentials, Go device-code sign-in prompts for an
account profile, account listings derive from stored sessions, credential
changes re-provision every provider entry automatically, sign-in flows end
with an "Add OpenCode entry" step, and the new **Review entries
and accounts** action reconciles stored accounts against the model entries
VS Code's Language Models editor knows about. Inline completion requests
authenticate with the chosen account's session via
`opencode.inlineSuggestionsAccount`.
