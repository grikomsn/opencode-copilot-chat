---
"opencode-bridge-for-copilot-chat": major
---

Require an explicit stable entryId for native API-key entries. Separate model selection identities from credential, catalog, and usage scopes, reject stale handles after key rotation, and validate account aliases. Serialize discovery journal mutations and keep account details out of journal records.

Add entryId to existing key entries and reselect models. All model IDs are qualified, including the default device-session profile; display-name inference and older usage migration are removed.
