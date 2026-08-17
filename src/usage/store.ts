import * as vscode from "vscode";
import { recordRequestUsage, type OpenCodeUsageSnapshot } from "./domain";

export class OpenCodeUsageStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<OpenCodeUsageSnapshot>();
  private snapshot: OpenCodeUsageSnapshot;

  readonly onDidChange = this.emitter.event;

  constructor(initial: OpenCodeUsageSnapshot = {}) {
    this.snapshot = initial;
  }

  get(): OpenCodeUsageSnapshot { return this.snapshot; }

  record(request: OpenCodeUsageSnapshot): void {
    this.snapshot = recordRequestUsage(this.snapshot, request);
    this.emitter.fire(this.snapshot);
  }

  clear(): void {
    this.snapshot = {};
    this.emitter.fire(this.snapshot);
  }

  dispose(): void { this.emitter.dispose(); }
}
