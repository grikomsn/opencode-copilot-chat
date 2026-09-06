/**
 * Latest-wins debounce for inline completion requests.
 *
 * A newer `debounce()` cancels the pending run's AbortController and replaces
 * it, so superseded suggestions never hit the network. Cancellation of an
 * older request must not touch the newer run — VS Code can cancel a stale
 * provider call after a newer keystroke already scheduled its own debounce.
 */

export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private controller: AbortController | undefined;

  constructor(public delayMs: number) {}

  /** Signal of the pending or running debounce; aborted after supersession. */
  get signal(): AbortSignal | undefined {
    return this.controller?.signal;
  }

  debounce(run: (signal: AbortSignal) => void | Promise<void>): void {
    this.cancel();
    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void run(signal);
    }, Math.max(0, this.delayMs));
  }

  /** Cancel any pending run. Safe to call repeatedly. */
  cancel(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.controller?.abort();
    this.controller = undefined;
  }

  dispose(): void {
    this.cancel();
  }
}
