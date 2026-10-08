import assert from "node:assert/strict";
import test from "node:test";
import { journalKey, readJournal, reconcile, updateJournalEntry, type EntryJournal, type EntryJournalRecord, type StoredAccount } from "./provider-journal";

class Memento {
  private readonly values = new Map<string, unknown>();
  get<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
  async update(key: string, value: unknown): Promise<void> { this.values.set(key, value); }
}

const record = (overrides: Partial<EntryJournalRecord> = {}): EntryJournalRecord => ({
  mode: "console",
  origin: "session",
  modelCount: 5,
  updatedAt: 1_000,
  ...overrides,
});

test("round-trips journal records through a memento", async () => {
  const state = new Memento() as never;
  assert.deepEqual(await readJournal(state), {});
  await updateJournalEntry(state, journalKey("console", "profile-work"), record({ profile: "work" }));
  await updateJournalEntry(state, journalKey("go", "legacy"), record({ mode: "go", origin: "key" }));
  const journal = await readJournal(state);
  assert.equal(journal["console:profile-work"]?.profile, "work");
  assert.equal(journal["go:legacy"]?.origin, "key");
  await updateJournalEntry(state, journalKey("console", "profile-work"), undefined);
  assert.equal((await readJournal(state))["console:profile-work"], undefined);
});

test("flags journal entries whose account no longer exists", () => {
  const journal: EntryJournal = {
    "console:profile-work": record({ profile: "work" }),
    "console:profile-default": record({ profile: "default" }),
    "go:key-abc": record({ mode: "go", origin: "key" }),
  };
  const accounts: readonly StoredAccount[] = [{ profile: "default", session: true, keys: [] }];
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(journal, accounts);
  assert.deepEqual(entriesWithoutCredentials.map((entry) => entry.key), ["console:profile-work"]);
  // The default session is referenced by its profile entry, so no orphan: none listed.
  assert.deepEqual(accountsWithoutEntries, []);
});

test("flags signed-in accounts no journal entry references", () => {
  const journal: EntryJournal = {
    "go:legacy": record({ mode: "go", origin: "key" }),
  };
  const accounts: readonly StoredAccount[] = [
    { profile: "default", session: false, keys: ["go"] },
    { profile: "work", session: true, keys: [], email: "work@example.com" },
  ];
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(journal, accounts);
  assert.deepEqual(entriesWithoutCredentials, []);
  // The go:legacy key entry backs the default account's Go key; work has no entry.
  assert.deepEqual(accountsWithoutEntries.map((account) => account.profile), ["work"]);
});

test("keeps anonymous key entries current and treats labeled key entries as account-bound", () => {
  const journal: EntryJournal = {
    "go:key-deadbeef": record({ mode: "go", origin: "key" }),
    "console:entry-team": record({ origin: "key", label: "team" }),
  };
  const { entriesWithoutCredentials } = reconcile(journal, [{ profile: "default", session: false, keys: ["go"] }]);
  assert.deepEqual(entriesWithoutCredentials.map((entry) => entry.key), ["console:entry-team"]);
});