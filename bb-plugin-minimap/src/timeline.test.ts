import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { watchTimeline, type Rows } from "./timeline.ts";

type Cursor = { anchorId: string; anchorSeq: number } | null;
type Callback = (event: { changes: string[] }) => void;

const row = (id: string, seq: number, text = "hello") =>
  ({ id, kind: "conversation", role: "assistant", text, sourceSeqStart: seq, turnId: null }) as never;

/** A fake SDK: `timeline` answers from a queue (the last answer repeats), `subscribe` keeps the callback. */
function fake(pages: { rows: unknown[]; older?: Cursor }[]) {
  const calls: Record<string, unknown>[] = [];
  let callback: Callback | null = null;
  let failNext = 0;
  const sdk = {
    threads: {
      timeline: async (query: Record<string, unknown>) => {
        calls.push(query);
        if (failNext > 0) {
          failNext--;
          throw new Error("down");
        }
        const page = query.beforeAnchorId ? pages.find((p) => (p as { before?: string }).before === query.beforeAnchorId) ?? pages[pages.length - 1]! : pages[0]!;
        return { rows: page.rows, timelinePage: { olderCursor: page.older ?? null } };
      },
    },
    subscribe: (args: { callback: Callback }) => {
      callback = args.callback;
      return () => {
        callback = null;
      };
    },
  };
  return {
    sdk: sdk as never,
    calls,
    signal: (...changes: string[]) => callback?.({ changes }),
    fail: (n: number) => (failNext = n),
    hasListener: () => callback !== null,
  };
}

/** Lets the promises a timer's callback started settle. */
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const clock = () => mock.timers.enable({ apis: ["setTimeout", "Date"] });

test("an active watcher reads the newest page at once and publishes its rows", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1), row("b", 2)] }]);
    const seen: Rows[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows) => seen.push(rows), false, true);
    await flush();
    assert.equal(f.calls.length, 1);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0]!.items.map((i) => i.id), ["a", "b"]);
    assert.equal(seen[0]!.rank.get("b"), 1);
    assert.equal(seen[0]!.hasOlder, false);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("an inactive watcher fetches nothing, however many signals come", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false);
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
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false);
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 1);
    watch.setActive(false);
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 1);
    watch.setActive(false);
    f.signal("message-added");
    watch.setActive(true);
    await flush();
    assert.equal(f.calls.length, 2);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a burst of signals is one read after 400ms of quiet", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false, true);
    await flush();
    f.signal("message-added");
    mock.timers.tick(300);
    f.signal("message-added");
    mock.timers.tick(300);
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

test("a stream that never pauses is still read every 1.5 seconds", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false, true);
    await flush();
    for (let i = 0; i < 16; i++) {
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
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false, true);
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

test("a failed read is tried again after 3 seconds", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1)] }]);
    f.fail(1);
    const seen: Rows[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows) => seen.push(rows), false, true);
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

test("older pages are read only while history or need asks, until the cursor ends", async () => {
  clock();
  try {
    const f = fake([
      { rows: [row("c", 30)], older: { anchorId: "p2", anchorSeq: 30 } },
      { rows: [row("b", 20)], older: { anchorId: "p1", anchorSeq: 20 }, before: "p2" } as never,
      { rows: [row("a", 10)], older: null, before: "p1" } as never,
    ]);
    const seen: Rows[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows) => seen.push(rows), false, true);
    await flush();
    mock.timers.tick(5000);
    await flush();
    assert.equal(f.calls.length, 1, "no older page without a reason");
    assert.equal(seen[0]!.hasOlder, true);
    watch.setNeed(true);
    for (let i = 0; i < 4; i++) {
      mock.timers.tick(300);
      await flush();
    }
    assert.equal(f.calls.length, 3);
    const last = seen[seen.length - 1]!;
    assert.deepEqual(last.items.map((i) => i.id), ["a", "b", "c"]);
    assert.equal(last.hasOlder, false);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("stop aborts the read in flight and unsubscribes", async () => {
  clock();
  try {
    const f = fake([{ rows: [row("a", 1)] }]);
    const watch = watchTimeline(f.sdk, "t", () => {}, false, true);
    await flush();
    assert.equal(f.hasListener(), true);
    watch.stop();
    assert.equal(f.hasListener(), false);
    assert.equal((f.calls[0]!.signal as AbortSignal).aborted, true);
  } finally {
    mock.timers.reset();
  }
});

/** A fake SDK whose `timeline` is a function of the query. */
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
      return () => {};
    },
  };
  return { sdk: sdk as never, calls, signal: (...changes: string[]) => callback?.({ changes }) };
}

const full = (rows: unknown[], tag: string) => ({ rows, tag, timelinePage: { olderCursor: null } });
const delta = (afterTag: string, tag: string, upsertRows: unknown[], rowOrder?: unknown[]) => ({
  tag,
  delta: { afterTag, upsertRows, rowOrder, fields: {} },
});

test("a refresh asks for what changed since the last tag and applies it", async () => {
  clock();
  try {
    const f = scripted((q) =>
      q.afterTag === "t1" ? delta("t1", "t2", [row("b", 2, "changed"), row("c", 3)], [[0, 2], "c"]) : full([row("a", 1), row("b", 2)], "t1"),
    );
    const seen: Rows[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows) => seen.push(rows), false, true);
    await flush();
    assert.deepEqual(f.calls[0], { threadId: "t", deferContent: "true", signal: f.calls[0]!.signal });
    f.signal("message-added");
    mock.timers.tick(400);
    await flush();
    assert.equal(f.calls[1]!.afterTag, "t1");
    assert.equal(f.calls[1]!.deferContent, "true");
    assert.deepEqual(seen[seen.length - 1]!.items.map((i) => i.id), ["a", "b", "c"]);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a delta that does not fit what is held is answered with a full read", async () => {
  clock();
  try {
    const f = scripted((q) => (q.afterTag === "t1" ? delta("t1", "t2", [], [[0, 9]]) : full([row("a", 1), row("b", 2)], q.afterTag ? "x" : "t1")));
    const seen: Rows[] = [];
    const watch = watchTimeline(f.sdk, "t", (rows) => seen.push(rows), false, true);
    await flush();
    f.signal("message-added");
    mock.timers.tick(400);
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
    const watch = watchTimeline(f.sdk, "t", () => {}, false, true);
    await flush();
    f.signal("history-rewritten");
    mock.timers.tick(400);
    await flush();
    assert.equal(f.calls[1]!.afterTag, undefined, "a rewrite is read in full");
    f.signal("message-added");
    mock.timers.tick(400);
    await flush();
    assert.equal(f.calls[2]!.afterTag, "t1");
    mock.timers.tick(61_000);
    f.signal("message-added");
    mock.timers.tick(400);
    await flush();
    assert.equal(f.calls[3]!.afterTag, undefined, "a minute on, a full page again");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("an older page asks for 100 segments, and a rewrite while it is in flight drops it", async () => {
  clock();
  try {
    let release: (() => void) | null = null;
    let reads = 0;
    const calls: Record<string, unknown>[] = [];
    let callback: Callback | null = null;
    const sdk = {
      threads: {
        timeline: async (query: Record<string, unknown>) => {
          calls.push(query);
          if (query.beforeAnchorId === "old-cursor") {
            await new Promise<void>((resolve) => (release = resolve));
            return { rows: [row("stale", 1)], timelinePage: { olderCursor: { anchorId: "stale-cursor", anchorSeq: 1 } } };
          }
          reads++;
          return reads === 1
            ? { rows: [row("a", 10)], tag: "t1", timelinePage: { olderCursor: { anchorId: "old-cursor", anchorSeq: 10 } } }
            : { rows: [row("a", 10), row("b", 11)], tag: "t2", timelinePage: { olderCursor: null } };
        },
      },
      subscribe: (args: { callback: Callback }) => {
        callback = args.callback;
        return () => {};
      },
    };
    const seen: Rows[] = [];
    const watch = watchTimeline(sdk as never, "t", (rows) => seen.push(rows), true, true);
    await flush();
    mock.timers.tick(1);
    await flush();
    const paging = calls.find((c) => c.beforeAnchorId === "old-cursor")!;
    assert.equal(paging.segmentLimit, "100");
    callback!({ changes: ["history-rewritten"] });
    mock.timers.tick(400);
    await flush();
    release!();
    await flush();
    mock.timers.tick(2000);
    await flush();
    const last = seen[seen.length - 1]!;
    assert.deepEqual(last.items.map((i) => i.id), ["a", "b"]);
    assert.equal(last.hasOlder, false, "the stale page's cursor was not taken");
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});

test("a whole history paging in is published once a second, not once a page", async () => {
  clock();
  try {
    let n = 0;
    const sdk = {
      threads: {
        timeline: async (query: Record<string, unknown>) => {
          if (!query.beforeAnchorId) return { rows: [row("new", 1000)], tag: "t", timelinePage: { olderCursor: { anchorId: "c0", anchorSeq: 1000 } } };
          n++;
          return { rows: [row("old" + n, 1000 - n)], timelinePage: { olderCursor: n < 8 ? { anchorId: "c" + n, anchorSeq: 1000 - n } : null } };
        },
      },
      subscribe: () => () => {},
    };
    const seen: Rows[] = [];
    const watch = watchTimeline(sdk as never, "t", (rows) => seen.push(rows), true, true);
    for (let i = 0; i < 12; i++) {
      await flush();
      mock.timers.tick(250);
    }
    await flush();
    assert.ok(seen.length <= 5, `published ${seen.length} times`);
    assert.equal(seen[seen.length - 1]!.items.length, 9);
    watch.stop();
  } finally {
    mock.timers.reset();
  }
});
