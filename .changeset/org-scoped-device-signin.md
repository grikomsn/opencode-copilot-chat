---
"opencode-bridge-for-copilot-chat": minor
---

Console device sign-in now requests organization scoping (`supports_org_scope`) during device authorization and honors a server-granted organization (`org_id`) from the token grant and refresh responses.

- Sessions that Console scoped to an organization can no longer switch organizations locally — sign in again to choose a different one, and refreshes reject a scope change.
- Multi-organization accounts without a server scope are no longer pinned to the first organization automatically; pick one after sign-in or from Manage (single-organization accounts still self-select).
- Refreshes that return a new organization notify model catalogs so they re-provision for the new organization.
- Entries no longer carry an `entryId`: model IDs are the raw hosted IDs (the host namespaces them per entry group), key entries are scoped by their API-key fingerprint, and deleting or re-adding an entry re-provisions its credential without stale-handle rejection.
