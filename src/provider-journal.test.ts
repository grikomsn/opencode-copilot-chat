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
  const accounts: readonly StoredAccount[] = [{ profile: "default", session: true }];
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(journal, accounts);
  // Key entries are user-managed in VS Code configuration and never flagged.
  assert.deepEqual(entriesWithoutCredentials.map((entry) => entry.key), ["console:profile-work"]);
  assert.deepEqual(accountsWithoutEntries, []);
});

test("flags signed-in accounts no journal entry references", () => {
  const journal: EntryJournal = {
    "go:profile-default": record({ mode: "go", origin: "session", profile: "default" }),
  };
  const accounts: readonly StoredAccount[] = [
    { profile: "default", session: true },
    { profile: "work", session: true, email: "work@example.com" },
  ];
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(journal, accounts);
  assert.deepEqual(entriesWithoutCredentials, []);
  assert.deepEqual(accountsWithoutEntries.map((account) => account.profile), ["work"]);
});

test("treats key-origin entries as current in all cases", () => {
  const journal: EntryJournal = {
    "go:key-deadbeef": record({ mode: "go", origin: "key" }),
    "console:entry-team": record({ origin: "key", label: "team" }),
  };
  const { entriesWithoutCredentials, accountsWithoutEntries } = reconcile(journal, [{ profile: "default", session: true }]);
  assert.deepEqual(entriesWithoutCredentials, []);
  assert.deepEqual(accountsWithoutEntries.map((account) => account.profile), ["default"]);
});


test("serializes concurrent updates, deletions, and recovery after a failed write", async () => {
  const values = new Map<string, unknown>();
  let fail = false;
  const state = { get: <T>(key: string) => values.get(key) as T | undefined,
    async update(key: string, value: unknown) {
      await new Promise((resolve) => setImmediate(resolve));
      if (fail) { fail = false; throw new Error("storage failed"); }
      values.set(key, value);
    } } as never;
  await Promise.all([updateJournalEntry(state, "first", record()), updateJournalEntry(state, "second", record())]);
  assert.deepEqual(Object.keys(readJournal(state)), ["first", "second"]);
  await Promise.all([updateJournalEntry(state, "first", undefined), updateJournalEntry(state, "third", record())]);
  assert.deepEqual(Object.keys(readJournal(state)), ["second", "third"]);
  fail = true;
  await assert.rejects(updateJournalEntry(state, "failed", record()), /storage failed/);
  await updateJournalEntry(state, "recovered", record());
  assert.equal(readJournal(state).failed, undefined);
  assert.ok(readJournal(state).recovered);
});

test("reconciles actual session references rather than synthetic journal keys", () => {
  const journal = { "renamed-entry": record({ profile: "work" }), "console:profile-default": record({ origin: "key" }) };
  assert.deepEqual(reconcile(journal, [{ profile: "work", session: true }, { profile: "default", session: true }]).accountsWithoutEntries.map((account) => account.profile), ["default"]);
});


test("does not copy old account details when updating observation history", async () => {
  const state = new Memento() as never;
  await updateJournalEntry(state, "old", { ...record(), email: "synthetic@example.invalid", orgName: "Synthetic organization" } as EntryJournalRecord);
  await updateJournalEntry(state, "new", record());
  assert.equal("email" in readJournal(state).old, false);
  assert.equal("orgName" in readJournal(state).old, false);
});
