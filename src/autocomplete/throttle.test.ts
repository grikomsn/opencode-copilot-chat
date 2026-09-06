import assert from "node:assert/strict";
import test from "node:test";
import { Debouncer } from "./throttle";

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("runs after the delay with the latest scheduled callback only", async () => {
  const debouncer = new Debouncer(10);
  const runs: number[] = [];
  debouncer.debounce(() => {
    runs.push(1);
  });
  debouncer.debounce(() => {
    runs.push(2);
  });
  debouncer.debounce(() => {
    runs.push(3);
  });
  await tick(40);
  assert.deepEqual(runs, [3]);
  debouncer.dispose();
});

test("cancel aborts the pending run's signal", async () => {
  const debouncer = new Debouncer(5);
  debouncer.debounce(() => {
    // never reached
  });
  const pending = debouncer.signal;
  debouncer.cancel();
  assert.equal(pending?.aborted, true);
  assert.equal(debouncer.signal, undefined);
  await tick(20);
  debouncer.dispose();
});

test("a newer debounce aborts the previous run's signal", async () => {
  const debouncer = new Debouncer(5);
  debouncer.debounce(() => {
    // superseded
  });
  const first = debouncer.signal;
  debouncer.debounce(() => {
    // latest wins
  });
  assert.equal(first?.aborted, true);
  assert.notEqual(debouncer.signal, undefined);
  assert.equal(debouncer.signal?.aborted, false);
  await tick(20);
  debouncer.dispose();
});