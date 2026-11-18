import assert from "node:assert/strict";
import { test } from "node:test";
import { createStatus, isRunning } from "./status.ts";

type Callback = (event: { id?: string; changes: string[]; metadata?: { statusChange?: { status: string } } }) => void;

/** A fake SDK: `threads.get` answers from `statuses` after `settle()`, and `subscribe` keeps the callback. */
function fake(statuses: Record<string, string>) {
  let callback: Callback | null = null;
  const reads: string[] = [];
  const waiting: (() => void)[] = [];
  let unsubscribed = 0;
  const sdk = {
    subscribe: (args: { callback: Callback }) => {
      callback = args.callback;
      return () => void unsubscribed++;
    },
    threads: {
      get: ({ threadId }: { threadId: string }) => {
        reads.push(threadId);
        return new Promise((resolve) => waiting.push(() => resolve({ status: statuses[threadId] })));
      },
    },
  };
  return {
    sdk: sdk as never,
    reads,
    emit: (event: Parameters<Callback>[0]) => callback?.(event),
    settle: async () => {
      waiting.splice(0).forEach((go) => go());
      await new Promise((resolve) => setImmediate(resolve));
    },
    unsubscribed: () => unsubscribed,
  };
}

test("isRunning: working statuses are working, idle and error are not", () => {
  for (const status of ["active", "starting", "stopping", "pending"]) assert.equal(isRunning(status), true);
  for (const status of ["idle", "error"]) assert.equal(isRunning(status), false);
});

test("first ask reads the thread once and answers null until it lands", async () => {
  const f = fake({ a: "active" });
  let changes = 0;
  const status = createStatus(f.sdk, () => changes++);
  assert.equal(status.working("a"), null);
  assert.equal(status.working("a"), null);
  assert.deepEqual(f.reads, ["a"]);
  await f.settle();
  assert.equal(status.working("a"), true);
  assert.equal(changes, 1);
  assert.deepEqual(f.reads, ["a"]);
});

test("a status-changed signal with a status flips the answer and reports it", async () => {
  const f = fake({ a: "active" });
  let changes = 0;
  const status = createStatus(f.sdk, () => changes++);
  status.working("a");
  await f.settle();
  f.emit({ id: "a", changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } });
  assert.equal(status.working("a"), false);
  assert.equal(changes, 2);
  // The same status again is not a change.
  f.emit({ id: "a", changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } });
  assert.equal(changes, 2);
});

test("a status-changed signal without a status reads the thread again", async () => {
  const f = fake({ a: "idle" });
  const status = createStatus(f.sdk, () => {});
  status.working("a");
  await f.settle();
  f.emit({ id: "a", changes: ["status-changed"] });
  assert.deepEqual(f.reads, ["a", "a"]);
});

test("other signals and threads that were never asked about are ignored", async () => {
  const f = fake({ a: "active" });
  let changes = 0;
  const status = createStatus(f.sdk, () => changes++);
  status.working("a");
  await f.settle();
  f.emit({ id: "a", changes: ["events-appended"] });
  f.emit({ id: "b", changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } });
  f.emit({ changes: ["status-changed"] });
  assert.equal(status.working("a"), true);
  assert.equal(changes, 1);
  assert.deepEqual(f.reads, ["a"]);
});

test("a signal that arrives while the first read is out wins over that older read", async () => {
  const f = fake({ a: "active" });
  const status = createStatus(f.sdk, () => {});
  status.working("a");
  f.emit({ id: "a", changes: ["status-changed"], metadata: { statusChange: { status: "idle" } } });
  await f.settle();
  assert.equal(status.working("a"), false);
});

test("a failed read is asked again on the next look", async () => {
  let calls = 0;
  const sdk = {
    subscribe: () => () => {},
    threads: { get: () => (++calls === 1 ? Promise.reject(new Error("down")) : Promise.resolve({ status: "active" })) },
  };
  const status = createStatus(sdk as never, () => {});
  assert.equal(status.working("a"), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.working("a"), null);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(status.working("a"), true);
  assert.equal(calls, 2);
});

test("dispose unsubscribes and drops late answers", async () => {
  const f = fake({ a: "active" });
  let changes = 0;
  const status = createStatus(f.sdk, () => changes++);
  status.working("a");
  status.dispose();
  await f.settle();
  assert.equal(f.unsubscribed(), 1);
  assert.equal(changes, 0);
});
