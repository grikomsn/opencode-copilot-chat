import type { Credential } from "./auth/auth";

/** Native selection identities and credential generations have separate lifetimes. */
export class NativeKeyEntries {
  private readonly entries = new Map<string, string>();
  private readonly credentials = new Map<string, Credential>();

  register(entryId: string, credentialRef: string, credential: Credential): string | undefined {
    const previous = this.entries.get(entryId);
    this.entries.set(entryId, credentialRef);
    this.credentials.set(credentialRef, credential);
    if (previous && previous !== credentialRef && ![...this.entries.values()].includes(previous)) {
      this.credentials.delete(previous);
      return previous;
    }
    return undefined;
  }

  matches(entryId: string, credentialRef: string): boolean { return this.entries.get(entryId) === credentialRef; }

  get(credentialRef: string): Credential | undefined { return this.credentials.get(credentialRef); }

  forget(entryId: string): void {
    const ref = this.entries.get(entryId);
    this.entries.delete(entryId);
    if (ref && ![...this.entries.values()].includes(ref)) this.credentials.delete(ref);
  }
}
