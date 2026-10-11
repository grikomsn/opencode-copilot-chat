# Org-scoped device sign-in — feasibility plan

Moving OpenCode Console organization selection from our side (client-side
`/api/orgs` fetch + auto-select first org + local switching) to the auth request
itself (server-scoped org grant), following the reference protocol proven by
`../tanstack-ai-opencode-console`.

## Verdict

**Feasible as a defensive, forward-compatible protocol adoption.**

We can adopt the sibling protocol now: opt in with `supports_org_scope: true` on
the device authorization request, honor a server-scoped `org_id` in the token
grant and refresh responses, and block local switching when the server scoped
the session. Until the server actually grants scope, the flow degrades to a
graceful client-side fallback (auto-select only when the account has exactly one
organization; otherwise require an explicit pick), which also matches the
upstream harness's stated direction.

Caveat: live server support is unconfirmed — the Console auth server is
closed-source and no official client sends the flag yet. The sibling adapter
asserts the server behavior ("Scoped grants preserve the workspace selected
during browser approval"), so we treat it as the evidence and keep the fallback
so nothing breaks if the server ignores the flag.

## Evidence

### Upstream harness (`anomalyco/opencode`, shallow clone at `/tmp/opencode-upstream`)

- `supports_org_scope` appears **nowhere** in the tree; `org_id`/`orgID` appear
  only in client-side org selection and API headers, never in device-flow
  payloads.
- Official CLI device login sends **only `client_id`**:
  `packages/opencode/src/account/account.ts:388-395` posts to
  `/auth/device/code` with a `ClientId` schema whose sole field is `client_id`
  (`:128-129`); `clientId = "opencode-cli"` (`:147`).
- Token and refresh response schemas have **no `org_id`**:
  `DeviceTokenSuccess` / `TokenRefresh` (`account.ts:83-108`).
- After the grant, the official client fetches `/api/user` + `/api/orgs` itself
  and auto-selects the first org (`account.ts:438-444`), with an explicit
  upstream TODO: *“When there are multiple orgs, let the user choose.”*
- The newer plugin client is identical:
  `packages/core/src/plugin/provider/opencode.ts:47` (device-code body),
  `:254-296` (grant/refresh + first-org pick), org used via `x-org-id` header.
- `packages/console/` contains only the web app; the device endpoints
  (`/auth/device/*`) are closed-source, so server-side behavior cannot be
  confirmed from the repo. A behavioral probe against the live server is the
  only authoritative confirmation.

### Sibling protocol (`tanstack-ai-opencode-console`, `packages/tanstack-ai-opencode-console/src/auth.ts`)

1. Authorization request: `POST /auth/device/code` body
   `{ client_id, supports_org_scope: true }` — explicit opt-in to server-side
   org binding.
2. Token grant: response may carry `org_id`; when present it becomes
   `scopedOrgId`, validated against the orgs discovered via `/api/orgs`.
3. Fallback when `org_id` is absent: auto-select only when the account has
   exactly one organization; otherwise leave `orgId` unset and refuse inference
   until an organization is chosen.
4. `selectOrganization` throws when the session is scoped (*“…sign in again to
   switch”*); local switching stays available for un-scoped sessions.
5. Refresh: response may carry `org_id`; a change to an existing scope throws,
   an omitted `org_id` keeps the prior scope.
6. README (`README.md:95`): “Scoped grants preserve the workspace selected
   during browser approval. Account-wide grants with multiple workspaces require
   `sessionAuth.selectOrganization(id)` before inference. A scoped grant cannot
   switch workspaces locally.”

### Our surface (recon inventory, `/tmp/org-scope-notes/task-3-current-surface.md`)

| Location | Today | Impact |
| --- | --- | --- |
| `src/auth/auth.ts:169-204` `completeDeviceSignIn` | Grant body without org scope; parallel `/api/user` + `/api/orgs`; auto-select `normalizedOrgs[0]` | Core change site |
| `src/auth/auth.ts:205-222` `selectOrganization` | Unrestricted local switch | Restrict when scoped |
| `src/auth/auth.ts:224-289` `refreshConsoleSession` | Merges tokens only; preserves org untouched | Parse + enforce `org_id` |
| `src/auth/auth.ts:30-34, 362-383` | `ConsoleSession.orgs/orgId/orgName`; `parseSession` requires `orgs` array; `normalizeOrganizations` | Add `scopedOrgId`; keep the rest |
| `src/commands/commands.ts:48, 69, 127-131, 211-230` | Manage-menu “Switch Console organization”, QuickPick, post-switch reload | Keep for un-scoped; scoped surfaces error |
| `src/commands/commands.ts:367, 393` | Diagnostics show org selected / orgName | Add server-scoped marker |
| `src/provider.ts:194`, `src/models/catalog.ts:72-94, 146-149, 230` | `x-org-id` header, org-scoped catalog, `catalogScope` | Unchanged |
| `src/auth/auth.test.ts:61-297` | Tests assert first-org auto-select, switching, refresh preservation | Rewrite per test plan below |

## Target design

1. **Authorization request** — `POST /auth/device/code` body becomes
   `{ client_id, supports_org_scope: true }`.
2. **Token grant** — keep the parallel `/api/user` + `/api/orgs` fetch (account
   info, scope validation, and the local fallback list). Parse an optional
   `org_id` string from the grant JSON; if present it must match a discovered
   organization, otherwise fail sign-in with a clear error.
3. **Session shape** — `ConsoleSession` gains optional `scopedOrgId?: string`
   (persisted, validated as an optional string by `parseSession`; `orgs` stays
   required so no stored-session migration is needed). `orgId` is set from
   `org_id` when granted; otherwise auto-select only when the account has
   exactly one organization; otherwise left unset for an explicit pick.
4. **Local selection** — `selectOrganization` throws when the session is
   scoped; behavior is unchanged for un-scoped sessions (manage-menu switch
   stays the explicit-pick path for multi-org accounts).
5. **Refresh** — parse optional `org_id` from the refresh response. If the
   session is scoped: a different `org_id` fails the refresh; an omitted
   `org_id` keeps the prior scope. If the response carries a new `org_id` for an
   un-scoped session, adopt it. Any effective org change fires `notifyChange()`
   so model catalogs re-provision (they already key on `catalogScope`, which
   embeds `orgId`).
6. **Identity guard** — `consoleSessionIdentity` stays token-based: refreshes
   always rotate tokens, so every org change arrives with a token change.
7. **Commands/UI** — switch command unchanged for un-scoped sessions; scoped
   sessions surface the auth-layer error message. Diagnostics gain a
   “(server-scoped)” marker on the organization line.
8. **Unchanged** — `x-org-id` request header, org-scoped catalog logic,
   concurrency guards, `onDidChange` plumbing, persisted-session schema
   requirements apart from the new optional field.

## Test plan (`src/auth/auth.test.ts`)

- Device authorization request body includes `supports_org_scope: true`.
- Grant with `org_id` → session carries matching `orgId` + `scopedOrgId`
  (org name resolved from the discovered orgs); grant with an unknown `org_id`
  → sign-in fails.
- Grant without `org_id`: single-org account auto-selects; multi-org account
  leaves `orgId` unset and `selectOrganization` still works.
- `selectOrganization` on a scoped session throws and persists nothing.
- Refresh adopts a returned `org_id` (notifying change listeners); a refresh
  that changes an existing scope fails; an omitted `org_id` keeps the prior
  scope.
- Existing fixtures keep their `orgs` arrays; the `/api/orgs` stub stays.

## Risks and mitigations

- **Server rejects the unknown body field** — evidenced against by the sibling
  adapter (same endpoints, live use). If ever observed (HTTP 400 at
  `/auth/device/code`), the follow-up is dropping the flag; no code fallback is
  added preemptively.
- **Behavior change for multi-org un-scoped users** — they now pick explicitly
  instead of getting a silent first-org auto-select (aligned with the upstream
  TODO and the sibling); covered by a Changeset and a README wording update.
- **Org name for scoped grants** — the grant response carries only `org_id`;
  the name is resolved from the discovered organizations list.

## Out of scope

- Zen/Go API-key auth paths, provider/transport behavior, probing the live
  Console server, and any server-side change.
