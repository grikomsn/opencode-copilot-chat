---
"opencode-bridge-for-copilot-chat": minor
---

Account separation across OpenCode providers. Named accounts (Console device
sessions via profiles) can now serve both the Console and Go gateways: Go
entries accept a `profile` alongside their API key, so Console can use one
account while Go uses another, or both gateways can share one account.
Service-account keys can be stored per account and per gateway with the new
**Add service-account key to an OpenCode account** flow, and optional entry
labels keep model IDs and usage scopes stable when a native key is rotated.
Model IDs are now qualified per credential so multiple entries of one vendor
cannot collide; the default Console device profile and the command-managed Go
key keep unqualified IDs for compatibility with earlier model selections.
Signed-out sessions no longer race credential refreshes, and 401 retries only
refresh session-backed credentials instead of swapping key-backed entries.