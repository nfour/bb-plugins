import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { applyDelta, type Row } from "./rows.ts";
import { watchTimeline } from "./watch.ts";

type Cursor = { anchorId: string; anchorSeq: number } | null;
type Callback = (event: { changes: string[] }) => void;
type Seen = { rows: Row[]; hasOlder: boolean };

const row = (id: string, seq: number, text = "hello") =>
  ({ id, kind: "conversation", role: "assistant", text, sourceSeqStart: seq, turnId: null }) as unknown as Row;
const ids = (rows: readonly Row[]) => rows.map((r) => r.id);

/** Lets the promises a timer's callback started settle. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const clock = () => mock.timers.enable({ apis: ["setTimeout", "Date"] });
const quiet = () => {};

/** A fake SDK whose `timeline` is a function of the query, and whose `subscribe` keeps the callback. */
function scripted(handler: (query: Record<string, unknown>) => unknown) {
  const calls: Record<string, unknown>[] = [];
  let callback: Callback | null = null;
  const sdk = {
    threads: {
      timeline: async (query: Record<string, unknown>) => {
        calls.push(query);
        return handler(query);
      },
    },
    subscribe: (args: { callback: Callback }) => {
      callback = args.callback;
      return () => {
        callback = null;
      };
    },
  };
  return { sdk: sdk as never, calls, signal: (...changes: string[]) => callback?.({ changes }), hasListener: () => callback !== null };
}

const full = (rows: unknown[], tag: string, older: Cursor = null) => ({ rows, tag, timelinePage: { olderCursor: older } });
const delta = (afterTag: string, tag: string, upsertRows: unknown[], rowOrder?: unknown[]) => ({
  tag,
  delta: { afterTag, upsertRows, rowOrder, fields: {} },
});

/** The usual script: a full page, then deltas that add one row each. */
function growing() {
  let n = 1;
  return scripted((q) => {
    if (!q.afterTag) return full([row("a", 1)], "t1");
    n++;
    return delta(String(q.afterTag), `t${n}`, [row("r" + n, n)], [[0, n - 1], "r" + n]);
  });
}

test("applyDelta: without an order upserts replace rows where they are, and cannot add one", () => {
  const r = (id: string, v = "") => ({ id, v });
  assert.deepEqual(applyDelta([r("a"), r("b")], { upsertRows: [r("b", "!")] }), [r("a"), r("b", "!")]);
  assert.equal(applyDelta([r("a")], { upsertRows: [r("z")] }), null);
});

test("applyDelta: an order of stretches and ids rebuilds the page, and refuses what does not fit", () => {
  const r = (id: string, v = "") => ({ id, v });
  const page = [r("a"), r("b"), r("c")];
  assert.deepEqual(applyDelta(page, { upsertRows: [r("c", "!"), r("d")], rowOrder: [[0, 3], "d"] }), [r("a"), r("b"), r("c", "!"), r("d")]);
  assert.deepEqual(applyDelta(page, { upsertRows: [], rowOrder: [[1, 3], "a"] }), [r("b"), r("c"), r("a")]);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 4]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["nope"] }), null);
  assert.equal(applyDelta(page, { upsertRows: [r("x")], rowOrder: [[0, 3]] }), null, "an upsert with no place would lose a row");
});

test("an active watcher reads the newest page at once and publishes its rows", async () => {
  clock();
  try {
    const f = scripted(() => full([row("a", 1), row("b", 2)], "t1", { anchorId: "c", anchorSeq: 1 }));
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    assert.equal(f.calls.length, 1);
    assert.deepEqual(ids(seen[0]!.rows), ["a", "b"]);
    assert.equal(seen[0]!.hasOlder, true);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("an inactive watcher reads nothing, however many signals come", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet);
    await flush();
    f.signal("message-added");
    f.signal("message-added");
    mock.timers.tick(5000);
    await flush();
    assert.equal(f.calls.length, 0);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("becoming active reads once, and not again when nothing has changed since", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet);
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 1);
    watch.setActive(false);
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 1);
    watch.setActive(false);
    f.signal("message-added");
    f.signal("message-added");
    mock.timers.tick(5000);
    await flush();
    assert.equal(f.calls.length, 1, "no read while inactive");
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 2, "one read for everything missed");
    assert.equal(f.calls[1]!.afterTag, "t1", "and it is a delta");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a burst of signals is one read after 300ms of quiet", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    f.signal("message-added");
    mock.timers.tick(200);
    f.signal("message-added");
    mock.timers.tick(200);
    await flush();
    assert.equal(f.calls.length, 1);
    mock.timers.tick(100);
    await flush();
    assert.equal(f.calls.length, 2);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a stream that never pauses is still read every second", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    for (let i = 0; i < 11; i++) {
      f.signal("message-added");
      mock.timers.tick(100);
    }
    await flush();
    assert.equal(f.calls.length, 2);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("changes that cannot alter a row are ignored", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    f.signal("title-changed", "read-state-changed");
    mock.timers.tick(2000);
    await flush();
    assert.equal(f.calls.length, 1);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a refresh asks for what changed since the last tag, leaves tool content out, and applies it", async () => {
  clock();
  try {
    const f = scripted((q) =>
      q.afterTag === "t1" ? delta("t1", "t2", [row("b", 2, "changed"), row("c", 3)], [[0, 2], "c"]) : full([row("a", 1), row("b", 2)], "t1"),
    );
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    assert.deepEqual(f.calls[0], { threadId: "t", deferContent: "true", signal: f.calls[0]!.signal });
    f.signal("message-added");
    mock.timers.tick(300);
    await flush();
    assert.equal(f.calls[1]!.afterTag, "t1");
    assert.equal(f.calls[1]!.deferContent, "true");
    const last = seen[seen.length - 1]!.rows;
    assert.deepEqual(ids(last), ["a", "b", "c"]);
    assert.equal((last[1] as { text: string }).text, "changed");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a delta carries on from the last delta's tag", async () => {
  clock();
  try {
    const f = growing();
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    for (let i = 0; i < 3; i++) {
      f.signal("message-added");
      mock.timers.tick(300);
      await flush();
    }
    assert.deepEqual(f.calls.map((c) => c.afterTag), [undefined, "t1", "t2", "t3"]);
    assert.deepEqual(ids(seen[seen.length - 1]!.rows), ["a", "r2", "r3", "r4"]);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a delta that does not fit what is held is answered with a full read", async () => {
  clock();
  try {
    const f = scripted((q) => (q.afterTag === "t1" ? delta("t1", "t2", [], [[0, 9]]) : full([row("a", 1), row("b", 2)], q.afterTag ? "x" : "t1")));
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    f.signal("message-added");
    mock.timers.tick(300);
    await flush();
    assert.equal(f.calls.length, 3);
    assert.equal(f.calls[2]!.afterTag, undefined);
    assert.equal(seen.length, 2);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a rewrite of history and a minute of deltas both force a full read", async () => {
  clock();
  try {
    const f = scripted((q) => (q.afterTag ? delta(String(q.afterTag), "t" + (f.calls.length + 1), []) : full([row("a", 1)], "t1")));
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    f.signal("history-rewritten");
    mock.timers.tick(300);
    await flush();
    assert.equal(f.calls[1]!.afterTag, undefined, "a rewrite is read in full");
    f.signal("message-added");
    mock.timers.tick(300);
    await flush();
    assert.equal(f.calls[2]!.afterTag, "t1");
    mock.timers.tick(61_000);
    f.signal("message-added");
    mock.timers.tick(300);
    await flush();
    assert.equal(f.calls[3]!.afterTag, undefined, "a minute on, a full page again");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a rewrite replaces the held rows; a full read after a minute merges the page into them", async () => {
  clock();
  try {
    let pages = [full([row("a", 1), row("b", 2)], "t1"), full([row("b", 2), row("c", 3)], "t2"), full([row("c", 3), row("d", 4)], "t3")];
    const f = scripted(() => pages.shift());
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    f.signal("history-compacted");
    mock.timers.tick(300);
    await flush();
    assert.deepEqual(ids(seen[seen.length - 1]!.rows), ["b", "c"]);
    mock.timers.tick(61_000);
    f.signal("message-added");
    mock.timers.tick(300);
    await flush();
    assert.deepEqual(ids(seen[seen.length - 1]!.rows), ["b", "c", "d"], "rows older than the page are kept");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a failed read is tried again after 3 seconds", async () => {
  clock();
  try {
    let fail = 1;
    const f = scripted(() => {
      if (fail-- > 0) throw new Error("down");
      return full([row("a", 1)], "t1");
    });
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    assert.equal(seen.length, 0);
    mock.timers.tick(2999);
    await flush();
    assert.equal(f.calls.length, 1);
    mock.timers.tick(1);
    await flush();
    assert.equal(f.calls.length, 2);
    assert.equal(seen.length, 1);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("an older page is read on request only, goes before the held rows, and ends at the last cursor", async () => {
  clock();
  try {
    const pages: Record<string, unknown> = {
      p2: full([row("b", 20)], "x", { anchorId: "p1", anchorSeq: 20 }),
      p1: full([row("a", 10)], "x", null),
    };
    const f = scripted((q) => (q.beforeAnchorId ? pages[String(q.beforeAnchorId)] : full([row("c", 30)], "t1", { anchorId: "p2", anchorSeq: 30 })));
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    mock.timers.tick(5000);
    await flush();
    assert.equal(f.calls.length, 1, "no older page without a request");
    watch.loadOlder();
    await flush();
    watch.loadOlder();
    await flush();
    watch.loadOlder();
    await flush();
    assert.equal(f.calls.length, 3, "none after the cursor ends");
    assert.equal(f.calls[1]!.deferContent, "true");
    const last = seen[seen.length - 1]!;
    assert.deepEqual(ids(last.rows), ["a", "b", "c"]);
    assert.equal(last.hasOlder, false);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("an older page that was in flight during a rewrite is dropped", async () => {
  clock();
  try {
    let release: (() => void) | null = null;
    let reads = 0;
    const f = scripted(async (q) => {
      if (q.beforeAnchorId === "old") {
        await new Promise<void>((resolve) => (release = resolve));
        return full([row("stale", 1)], "x", { anchorId: "stale-cursor", anchorSeq: 1 });
      }
      reads++;
      return reads === 1 ? full([row("a", 10)], "t1", { anchorId: "old", anchorSeq: 10 }) : full([row("a", 10), row("b", 11)], "t2", null);
    });
    const seen: Seen[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows, hasOlder) => seen.push({ rows, hasOlder }), quiet, true);
    await flush();
    watch.loadOlder();
    await flush();
    f.signal("history-rewritten");
    mock.timers.tick(300);
    await flush();
    release!();
    await flush();
    const last = seen[seen.length - 1]!;
    assert.deepEqual(ids(last.rows), ["a", "b"]);
    assert.equal(last.hasOlder, false, "the stale page's cursor was not taken");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a failed older page is not asked for again for 3 seconds", async () => {
  clock();
  try {
    let fail = true;
    const f = scripted((q) => {
      if (!q.beforeAnchorId) return full([row("b", 20)], "t1", { anchorId: "p", anchorSeq: 20 });
      if (fail) throw new Error("down");
      return full([row("a", 10)], "x", null);
    });
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    watch.loadOlder();
    await flush();
    fail = false;
    watch.loadOlder();
    await flush();
    assert.equal(f.calls.length, 2);
    mock.timers.tick(3000);
    watch.loadOlder();
    await flush();
    assert.equal(f.calls.length, 3);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("stop aborts the read in flight and unsubscribes", async () => {
  clock();
  try {
    const f = growing();
    const watch = watchTimeline(f.sdk, "t", quiet, quiet, true);
    await flush();
    assert.equal(f.hasListener(), true);
    watch.stop();
    assert.equal(f.hasListener(), false);
    assert.equal((f.calls[0]!.signal as AbortSignal).aborted, true);
  } finally {
    mock.timers.reset();
  }
});
