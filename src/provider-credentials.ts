import type { Credential } from "./auth/auth";

/** Key-scoped credentials stay valid while their key stays provisioned. */
export class NativeKeyEntries {
  private readonly credentials = new Map<string, Credential>();

  register(credentialRef: string, credential: Credential): void {
    this.credentials.set(credentialRef, credential);
  }

  get(credentialRef: string): Credential | undefined { return this.credentials.get(credentialRef); }
}
