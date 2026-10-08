import type * as vscode from "vscode";

/**
 * Reconciliation journal between the accounts this extension manages and
 * the model entries VS Code's Language Models editor last asked about.
 *
 * VS Code exposes no API to enumerate or write provider entries, so the
 * provider records what `provideLanguageModelChatInformation` was called for
 * and commands compare that against SecretStorage sessions to surface drifted
 * setups: signed-in accounts no entry uses, and session entries whose account
 * is gone. Service-key entries are user-managed inside VS Code configuration
 * and never part of the reconciliation.
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
  /** Number of models the entry last provided. */
  modelCount: number;
  /** Last time VS Code asked this entry for models (ms epoch). */
  updatedAt: number;
}

export type EntryJournal = Readonly<Record<string, EntryJournalRecord>>;

export interface StoredAccount {
  /** Account profile ID. */
  profile: string;
  /** Always true: device sessions are the only credential this extension manages. */
  session: boolean;
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

/** Returns the journal entries VS Code last asked about. */
export function readJournal(state: vscode.Memento): EntryJournal {
  const journal = state.get<EntryJournal>(ENTRY_JOURNAL_STATE_KEY) ?? {};
  return Object.fromEntries(Object.entries(journal).map(([key, record]) => [key, {
    mode: record.mode, origin: record.origin, modelCount: record.modelCount, updatedAt: record.updatedAt,
    ...(record.profile ? { profile: record.profile } : {}), ...(record.label ? { label: record.label } : {}),
  }]));
}

const mutations = new WeakMap<vscode.Memento, Promise<void>>();

/** Records or clears one entry in the journal; passes `undefined` to remove. */
export async function updateJournalEntry(
  state: vscode.Memento,
  key: string,
  record: EntryJournalRecord | undefined,
): Promise<void> {
  const previous = mutations.get(state) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(async () => {
    const journal = { ...readJournal(state) };
    if (record === undefined) delete journal[key];
    else journal[key] = record;
    await state.update(ENTRY_JOURNAL_STATE_KEY, journal);
  });
  mutations.set(state, current);
  try { await current; } finally { if (mutations.get(state) === current) mutations.delete(state); }
}

export interface Reconciliation {
  /** Journal entries whose account session no longer exists. */
  entriesWithoutCredentials: Array<{ key: string; record: EntryJournalRecord }>;
  /** Signed-in accounts no journal entry references. */
  accountsWithoutEntries: StoredAccount[];
}

/**
 * Compares the journal against stored accounts. A session entry is "without
 * credential" when its referenced account profile has no stored session;
 * key-origin entries are user-managed inside VS Code provider configuration,
 * so they are always treated as current here.
 */
export function reconcile(journal: EntryJournal, accounts: readonly StoredAccount[]): Reconciliation {
  const entriesWithoutCredentials: Reconciliation["entriesWithoutCredentials"] = [];
  for (const [key, record] of Object.entries(journal)) {
    if (record.origin === "key") continue;
    if (record.profile && accounts.some((account) => account.profile === record.profile)) continue;
    entriesWithoutCredentials.push({ key, record });
  }
  const accountsWithoutEntries = accounts.filter((account) => {
    return !Object.values(journal).some((record) => record.origin === "session" && record.profile === account.profile);
  });
  return { entriesWithoutCredentials, accountsWithoutEntries };
}
