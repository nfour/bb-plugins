import type { useSdk } from "@get-bb/plugin-sdk/app";
import { applyDelta, flatten, itemsOf, mergeNewest, prependOlder, type Memo, type Row } from "./rows.ts";
import type { Item } from "./model.ts";

type Sdk = ReturnType<typeof useSdk>;

/** What the strip is told: every row held, in order, and whether older ones are still to come. */
export interface Rows {
  items: Item[];
  /** Data row id → rank (its index in `items`). */
  rank: Map<string, number>;
  hasOlder: boolean;
}

/** A burst of signals is refetched once it has been quiet this long... */
const QUIET_MS = 400;
/** ...or once its first signal is this old, so a stream that never pauses still refreshes. */
const MAX_WAIT_MS = 1500;
const RETRY_MS = 3000;
/** The wait between older pages, so loading a long thread's history never competes with the reader. */
const OLDER_GAP_MS = 250;

/** Segments per older page: the API allows 100 (101 is refused), five times the default. */
const OLDER_SEGMENTS = "100";

/** While the whole history pages in, the strip is told at most this often. */
const PAGING_EMIT_MS = 1000;
/** The most rows held; a longer history keeps its newest rows and the strip shows the rest as unread. */
const MAX_ROWS = 12000;

/** A delta is built on the last page read; a full one this often keeps any drift from lasting. */
const FULL_EVERY_MS = 60_000;

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
const REWRITES = new Set(["history-rewritten", "history-compacted"]);

/**
 * Follows the thread's timeline and calls `publish` with its rows as items.
 *
 * The newest page is fetched first. With `history` on, older pages follow one at a time
 * with a pause between them until the whole thread is held, so the strip can cover all of
 * it; off (the default) a long thread's older pages are fetched only while the page shows rows older than the ones held (`setNeed`). A
 * signal from the thread refetches the newest page and merges it by id. This runs
 * outside React: nothing here renders anything.
 */
export interface Watch {
  /** Whether older pages are fetched; turning it on starts at once, off lets the one in flight finish. */
  setHistory(on: boolean): void;
  /** Whether the page shows older rows than are held: older pages are fetched while it does, a page at a time. */
  setNeed(on: boolean): void;
  /**
   * Whether the strip is shown (and the tab visible). While it is not, nothing is fetched: signals
   * only mark the held rows stale, and becoming active reads once if anything was missed.
   */
  setActive(on: boolean): void;
  stop(): void;
}

export function watchTimeline(sdk: Sdk, threadId: string, publish: (rows: Rows) => void, history: boolean, startActive = false): Watch {
  let active = startActive;
  let stale = true;
  let wantHistory = history;
  let need = false;
  let rows: Row[] = [];
  let cursor: { anchorId: string; anchorSeq: number } | null = null;
  let loaded = false;
  // Counts the times the held rows were replaced wholesale: an older page fetched before that belongs to rows that are gone.
  let epoch = 0;
  let disposed = false;
  const controller = new AbortController();
  const memo: Memo = new Map();

  const emit = () => {
    if (disposed) return;
    const items = itemsOf(rows, memo);
    const rank = new Map<string, number>();
    rows.forEach((row, i) => rank.set(row.id, i));
    publish({ items, rank, hasOlder: cursor !== null });
  };

  type Timer = ReturnType<typeof setTimeout>;
  // The newest page as the last read left it, the tag that read carries, and when a full page was last read:
  // a refresh asks for what changed since the tag and applies it to the page, instead of reading everything again.
  let pageRows: Row[] = [];
  let tag: string | null = null;
  let fullAt = 0;
  let emitTimer: Timer | undefined;
  const emitNow = () => {
    clearTimeout(emitTimer);
    emitTimer = undefined;
    emit();
  };
  const emitSoon = () => {
    emitTimer ??= setTimeout(emitNow, PAGING_EMIT_MS);
  };
  let timer: Timer | undefined;
  let waitingSince = 0;
  let issued = 0;
  let replace = false;
  const newest = async () => {
    waitingSince = 0;
    timer = undefined;
    if (disposed || !active) return;
    stale = false;
    const mine = ++issued;
    const rewrite = replace;
    replace = false;
    try {
      const asDelta = loaded && !rewrite && tag !== null && Date.now() - fullAt < FULL_EVERY_MS;
      // Tool rows' content is never read here (a row's size does not depend on it), so it is left out.
      const page = asDelta
        ? await sdk.threads.timeline({ threadId, afterTag: tag!, deferContent: "true", signal: controller.signal })
        : await sdk.threads.timeline({ threadId, deferContent: "true", signal: controller.signal });
      if (disposed || mine !== issued) return;
      let updates: readonly Row[] = [];
      let startOver = false;
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
      } else {
        pageRows = page.rows;
        fullAt = Date.now();
        updates = page.timelinePage.olderRowUpdates ?? [];
        startOver = !loaded || rewrite;
        if (startOver) cursor = page.timelinePage.olderCursor;
      }
      tag = page.tag;
      if (startOver) {
        rows = flatten(pageRows);
        epoch++;
        loaded = true;
        scheduleOlder(0);
      } else {
        rows = mergeNewest(rows, flatten(pageRows), flatten(updates));
      }
      emit();
    } catch {
      if (disposed || mine !== issued) return;
      replace ||= rewrite;
      stale = true;
      timer = setTimeout(newest, RETRY_MS);
    }
  };
  void newest();

  let olderTimer: Timer | undefined;
  let loading = false;
  const older = async () => {
    olderTimer = undefined;
    if (disposed || !active || !(wantHistory || need) || loading || cursor === null || rows.length >= MAX_ROWS) return;
    loading = true;
    const mine = epoch;
    try {
      const page = await sdk.threads.timeline({
        threadId,
        deferContent: "true",
        segmentLimit: OLDER_SEGMENTS,
        beforeAnchorId: cursor.anchorId,
        beforeAnchorSeq: String(cursor.anchorSeq),
        signal: controller.signal,
      });
      if (disposed) return;
      // A rewrite replaced the rows (and the cursor) while this page was in flight: it belongs to the old ones.
      if (mine !== epoch) {
        scheduleOlder(0);
        return;
      }
      rows = prependOlder(rows, flatten(page.rows));
      cursor = page.timelinePage.olderCursor;
      // Pages the strip asked for show at once; a whole history paging in is shown a second at a time.
      if (need || cursor === null) emitNow();
      else emitSoon();
      scheduleOlder(OLDER_GAP_MS);
    } catch {
      scheduleOlder(RETRY_MS);
    } finally {
      loading = false;
    }
  };
  function scheduleOlder(wait: number) {
    if (disposed || !active || !(wantHistory || need) || cursor === null || olderTimer !== undefined) return;
    olderTimer = setTimeout(older, wait);
  }

  const unsubscribe = sdk.subscribe({
    event: "thread:changed",
    threadId,
    callback: ({ changes }) => {
      if (changes.length > 0 && changes.every((change) => IGNORED_CHANGES.has(change))) return;
      if (changes.some((change) => REWRITES.has(change))) replace = true;
      stale = true;
      if (!active) return;
      const now = Date.now();
      waitingSince ||= now;
      clearTimeout(timer);
      timer = setTimeout(newest, Math.min(QUIET_MS, waitingSince + MAX_WAIT_MS - now));
    },
  });

  return {
    setHistory(on) {
      wantHistory = on;
      if (on) scheduleOlder(0);
    },
    setNeed(on) {
      need = on;
      if (on) scheduleOlder(0);
    },
    setActive(on) {
      if (on === active) return;
      active = on;
      if (!on) {
        clearTimeout(timer);
        clearTimeout(olderTimer);
        timer = olderTimer = undefined;
        waitingSince = 0;
        return;
      }
      if (stale) void newest();
      else scheduleOlder(0);
    },
    stop() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
      clearTimeout(olderTimer);
      clearTimeout(emitTimer);
      unsubscribe();
    },
  };
}
