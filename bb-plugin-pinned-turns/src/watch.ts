import type { useSdk } from "@get-bb/plugin-sdk/app";
import { applyDelta, flatten, mergeNewest, prependOlder, type Row } from "./rows.ts";

type Sdk = ReturnType<typeof useSdk>;

/** Writes one line to the plugin log; a no-op unless the debug log is on. */
export type Debug = (event: string, data: Record<string, number | string | boolean>) => void;

/** A burst of signals is refetched once it has been quiet this long... */
const QUIET_MS = 300;
/** ...or once its first signal is this old, so a stream that never pauses still refreshes. */
const MAX_WAIT_MS = 1000;
/** Where a failed fetch waits before being tried again. */
const RETRY_MS = 3000;
/** A delta is built on the last page read; a full one this often keeps any drift from lasting. */
const FULL_EVERY_MS = 60_000;
/** How often the debug log's counts of signals and refetches are written. */
const STATS_MS = 5000;

/** Thread changes that cannot alter a row, so they do not warrant a refetch. */
const IGNORED_CHANGES = new Set([
  "archived-changed",
  "environment-changed",
  "parent-changed",
  "pin-state-changed",
  "queue-changed",
  "read-state-changed",
  "tabs-changed",
  "terminals-changed",
  "title-changed",
]);
/** Changes after which the rows held may no longer exist: they are replaced, not merged. */
const REWRITES = new Set(["history-rewritten", "history-compacted"]);

export interface Watch {
  /**
   * Whether the bar is shown (and the tab visible). While it is not, nothing is fetched: signals only
   * mark the held rows stale, and becoming active reads once if anything was missed.
   */
  setActive(on: boolean): void;
  /** Fetches the page of rows before the oldest held, if there is one and none is on its way. */
  loadOlder(): void;
  stop(): void;
}

/**
 * Follows the thread's timeline and calls `publish` with its rows, in order, and whether older ones
 * exist that are not held.
 *
 * Only the newest page is fetched up front; older pages come on demand (`loadOlder`), because a
 * thread's top is rarely where anyone is. A signal from the thread asks for what changed since the
 * last read (`afterTag`, a few KB) and applies it to the newest page, which is merged into the rows
 * by id, so a streaming reply keeps its title current without reading the page again. A change that
 * does not fit what is held, a rewrite of history and a minute since the last full page read the
 * page in full. Tool rows' content is left out (`deferContent`): the bar reads a row's kind, status
 * and, for a message, its text, which are not deferred.
 *
 * Timing goes to the debug log: the first load, each older page, and one line per 5s of activity
 * counting the thread's signals against the refetches they caused. This runs outside React and uses
 * the global timers, so the tests drive it with `mock.timers`.
 */
export function watchTimeline(sdk: Sdk, threadId: string, publish: (rows: Row[], hasOlder: boolean) => void, log: Debug, startActive = false): Watch {
  let active = startActive;
  let stale = true;
  let rows: Row[] = [];
  let cursor: { anchorId: string; anchorSeq: number } | null = null;
  let loaded = false;
  // Counts the times the held rows were replaced wholesale: an older page fetched before that belongs to rows that are gone.
  let epoch = 0;
  let disposed = false;
  const controller = new AbortController();

  type Timer = ReturnType<typeof setTimeout>;
  const stats = { signals: 0, refetches: 0, deltas: 0, errors: 0, fetchMsMax: 0, from: Date.now() };
  let flushTimer: Timer | undefined;
  const flush = () => {
    flushTimer = undefined;
    log("timeline", {
      windowMs: Date.now() - stats.from,
      signals: stats.signals,
      refetches: stats.refetches,
      deltas: stats.deltas,
      errors: stats.errors,
      fetchMsMax: Math.round(stats.fetchMsMax),
      rows: rows.length,
    });
    Object.assign(stats, { signals: 0, refetches: 0, deltas: 0, errors: 0, fetchMsMax: 0, from: Date.now() });
  };
  const count = (key: "signals" | "refetches" | "errors") => {
    stats[key]++;
    flushTimer ??= setTimeout(flush, STATS_MS);
  };

  const publishRows = () => {
    if (!disposed) publish(rows, cursor !== null);
  };

  // The newest page as the last read left it, the tag that read carries, and when a full page was last read.
  let pageRows: Row[] = [];
  let tag: string | null = null;
  let fullAt = 0;
  let timer: Timer | undefined;
  let waitingSince = 0;
  let issued = 0;
  // Set by a signal that says the rows held are stale; the next fetch replaces them.
  let replace = false;
  const newest = async () => {
    waitingSince = 0;
    timer = undefined;
    if (disposed || !active) return;
    stale = false;
    // Answers can arrive out of order; only the newest request's is used.
    const mine = ++issued;
    const began = Date.now();
    const rewrite = replace;
    replace = false;
    try {
      const asDelta = loaded && !rewrite && tag !== null && began - fullAt < FULL_EVERY_MS;
      const page = asDelta
        ? await sdk.threads.timeline({ threadId, afterTag: tag!, deferContent: "true", signal: controller.signal })
        : await sdk.threads.timeline({ threadId, deferContent: "true", signal: controller.signal });
      if (disposed || mine !== issued) return;
      const took = Date.now() - began;
      let updates: readonly Row[];
      if ("delta" in page) {
        const next = applyDelta(pageRows, page.delta);
        if (!next) {
          // The delta does not fit what is held: read the whole page.
          tag = null;
          void newest();
          return;
        }
        pageRows = next;
        updates = page.delta.fields.timelinePage?.olderRowUpdates ?? [];
        stats.deltas++;
      } else {
        pageRows = page.rows;
        fullAt = Date.now();
        updates = page.timelinePage.olderRowUpdates ?? [];
        if (!loaded || rewrite) cursor = page.timelinePage.olderCursor;
      }
      tag = page.tag;
      if (!loaded || rewrite) {
        rows = flatten(pageRows);
        epoch++;
        loaded = true;
        log("load", { ms: took, rows: rows.length, more: cursor !== null, rewrite });
      } else {
        rows = mergeNewest(rows, flatten(pageRows), flatten(updates));
        count("refetches");
        stats.fetchMsMax = Math.max(stats.fetchMsMax, took);
      }
      publishRows();
    } catch {
      if (disposed || mine !== issued) return;
      count("errors");
      replace ||= rewrite;
      stale = true;
      // Nothing else will prompt a retry on a thread that has gone quiet.
      timer = setTimeout(newest, RETRY_MS);
    }
  };
  void newest();

  const unsubscribe = sdk.subscribe({
    event: "thread:changed",
    threadId,
    callback: ({ changes }) => {
      if (changes.length > 0 && changes.every((change) => IGNORED_CHANGES.has(change))) return;
      count("signals");
      if (changes.some((change) => REWRITES.has(change))) replace = true;
      stale = true;
      if (!active) return;
      const now = Date.now();
      waitingSince ||= now;
      clearTimeout(timer);
      timer = setTimeout(newest, Math.min(QUIET_MS, waitingSince + MAX_WAIT_MS - now));
    },
  });

  let loading = false;
  let blockedUntil = 0;
  const older = async () => {
    if (disposed || !active || loading || cursor === null || Date.now() < blockedUntil) return;
    loading = true;
    const mine = epoch;
    const began = Date.now();
    try {
      const page = await sdk.threads.timeline({
        threadId,
        deferContent: "true",
        beforeAnchorId: cursor.anchorId,
        beforeAnchorSeq: String(cursor.anchorSeq),
        signal: controller.signal,
      });
      // A rewrite replaced the rows (and the cursor) while this page was in flight: it belongs to the old ones.
      if (disposed || mine !== epoch) return;
      rows = prependOlder(rows, flatten(page.rows));
      cursor = page.timelinePage.olderCursor;
      log("older", { ms: Date.now() - began, rows: rows.length, more: cursor !== null });
      publishRows();
    } catch {
      // Asked for again on every paint while a half is missing; do not hammer a failing server.
      blockedUntil = Date.now() + RETRY_MS;
    } finally {
      loading = false;
    }
  };

  return {
    setActive(on) {
      if (on === active) return;
      active = on;
      if (on) {
        if (stale) void newest();
        return;
      }
      clearTimeout(timer);
      timer = undefined;
      waitingSince = 0;
    },
    loadOlder() {
      void older();
    },
    stop() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(flushTimer);
      unsubscribe();
    },
  };
}
