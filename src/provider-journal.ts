import type * as vscode from "vscode";

/**
 * Reconciliation journal between the credentials this extension manages and
 * the model entries VS Code's Language Models editor last asked about.
 *
 * VS Code exposes no API to enumerate or write provider entries, so the
 * provider records what `provideLanguageModelChatInformation` was called for
 * and commands compare that against SecretStorage state to surface drifted
 * setups: signed-in accounts no entry uses, and entries whose credential is
 * gone.
 */

export const ENTRY_JOURNAL_STATE_KEY = "opencode.entryJournal.v1";

export interface EntryJournalRecord {
  /** Gateway the entry serves. */
  mode: "console" | "go";
  /** Whether the entry uses a stored service-account key or a device session. */
  origin: "key" | "session";
  /** Account profile the entry references, if any. */
  profile?: string;
  /** Optional stable entry label for service-key entries. */
  label?: string;
  /** Account email captured during device sign-in, when available. */
  email?: string;
  /** Organization the device session was scoped to, when available. */
  orgName?: string;
  /** Number of models the entry last provided. */
  modelCount: number;
  /** Last time VS Code asked this entry for models (ms epoch). */
  updatedAt: number;
}

export type EntryJournal = Readonly<Record<string, EntryJournalRecord>>;

export interface StoredAccount {
  /** Account profile ID. */
  profile: string;
  /** Whether the account holds a device-session. */
  session: boolean;
  /** Gateways with a stored service-account key for this account. */
  keys: readonly ("console" | "go")[];
  email?: string;
  orgName?: string;
}

export interface JournalStore {
  read(): Promise<EntryJournal>;
  update(key: string, record: EntryJournalRecord | undefined): Promise<void>;
}

/** Journal key for one provider entry credential scope. */
export function journalKey(mode: "console" | "go", credentialId: string): string {
  return `${mode}:${credentialId}`;
}

/** Returns the journal entries VS Code last asked about, dropped when credentials were reused with the same identity. */
export async function readJournal(state: vscode.Memento): Promise<EntryJournal> {
  return (await state.get<EntryJournal>(ENTRY_JOURNAL_STATE_KEY)) ?? {};
}

/** Records or clears one entry in the journal; passes `undefined` to remove. */
export async function updateJournalEntry(
  state: vscode.Memento,
  key: string,
  record: EntryJournalRecord | undefined,
): Promise<void> {
  const journal = { ...(await readJournal(state)) };
  if (record === undefined) delete journal[key];
  else journal[key] = record;
  await state.update(ENTRY_JOURNAL_STATE_KEY, journal);
}

export interface Reconciliation {
  /** Journal entries whose configured account or key no longer exists. */
  entriesWithoutCredentials: Array<{ key: string; record: EntryJournalRecord }>;
  /** Signed-in accounts no journal entry references. */
  accountsWithoutEntries: StoredAccount[];
}

/** Which journal keys are expected to back an entry for one account. */
function journalKeysForAccount(account: StoredAccount): string[] {
  const keys = [journalKey("console", `profile-${account.profile}`), journalKey("go", `profile-${account.profile}`)];
  // The default account's Go key historically resolves through the command-
  // managed `legacy` credential, so its entry may carry that identity.
  if (account.keys.includes("go") && account.profile === "default") keys.push(journalKey("go", "legacy"));
  return keys;
}

/**
 * Compares the journal against stored accounts. An entry is "without
 * credential" when no stored account matches its identity: profile-backed
 * entries must reference an existing account profile (with a session or a key
 * for that gateway), key-backed entries must carry a profile or label that a
 * stored account provides.
 */
export function reconcile(journal: EntryJournal, accounts: readonly StoredAccount[]): Reconciliation {
  const entriesWithoutCredentials: Reconciliation["entriesWithoutCredentials"] = [];
  for (const [key, record] of Object.entries(journal)) {
    if (record.profile && accounts.some((account) => account.profile === record.profile)) continue;
    if (record.origin === "key" && record.label && accounts.some((account) => account.keys.length > 0 && account.profile === record.label)) continue;
    if (record.origin === "key" && !record.profile && !record.label) {
      // Anonymous fingerprint-backed entries cannot be matched by name; they
      // stay valid as long as their key still exists, which the journal
      // cannot check. Treated as current.
      continue;
    }
    entriesWithoutCredentials.push({ key, record });
  }
  const accountsWithoutEntries = accounts.filter((account) => {
    if (!account.session && account.keys.length === 0) return false;
    return !journalKeysForAccount(account).some((key) => journal[key] !== undefined);
  });
  return { entriesWithoutCredentials, accountsWithoutEntries };
}