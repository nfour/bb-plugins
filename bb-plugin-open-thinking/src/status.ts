import type { useSdk } from "@get-bb/plugin-sdk/app";

type Sdk = Pick<ReturnType<typeof useSdk>, "subscribe" | "threads">;

/** How long after a failed read a thread is left alone. */
export const RETRY_MS = 5000;

/** The thread statuses in which a turn is still going or about to. */
const RUNNING = new Set(["active", "starting", "stopping", "pending"]);

export function isRunning(status: string): boolean {
  return RUNNING.has(status);
}

export interface Status {
  /** Whether the thread is working, or `null` until it is known (one read is under way). */
  working(thread: string): boolean | null;
  /** Reads every thread asked about again; for the page coming back after a gap in which signals may have been missed. */
  refresh(): void;
  dispose(): void;
}

/**
 * Whether each thread on the page is working. A thread is read once the first time it is asked about; after that
 * its realtime `status-changed` signals carry the status. Nothing is read for threads that are not on the page.
 */
export function createStatus(sdk: Sdk, onChange: () => void, now: () => number = Date.now): Status {
  const known = new Map<string, boolean>();
  const asked = new Set<string>();
  /** Threads with a read out, so a look or a refresh does not send a second one. */
  const reading = new Set<string>();
  /** When a thread's last read failed: it is not asked again for `RETRY_MS`. */
  const failedAt = new Map<string, number>();
  /** Threads whose status a realtime signal has set since their read began: that read is older and is dropped. */
  const signalled = new Set<string>();
  const abort = new AbortController();
  let disposed = false;

  const set = (thread: string, working: boolean) => {
    if (disposed) return;
    const before = known.get(thread);
    known.set(thread, working);
    if (before !== working) onChange();
  };
  /** A read the signals asked for (`force`) goes out even when another is under way: the older one may predate the change. */
  const read = (thread: string, force = false) => {
    if (reading.has(thread) && !force) return;
    reading.add(thread);
    asked.add(thread);
    signalled.delete(thread);
    failedAt.delete(thread);
    sdk.threads.get({ threadId: thread, signal: abort.signal }).then(
      (found) => {
        reading.delete(thread);
        if (!signalled.has(thread)) set(thread, isRunning(found.status));
      },
      // Asked again on a look at the page once `RETRY_MS` has passed.
      () => {
        reading.delete(thread);
        // A thread that was known keeps its answer; one never read is asked for again after the gap.
        if (disposed || known.has(thread)) return;
        asked.delete(thread);
        failedAt.set(thread, now());
      },
    );
  };

  const unsubscribe = sdk.subscribe({
    event: "thread:changed",
    callback: ({ id, changes, metadata }) => {
      if (!id || !asked.has(id) || !changes.includes("status-changed")) return;
      const status = metadata?.statusChange?.status;
      if (status) {
        signalled.add(id);
        set(id, isRunning(status));
      } else read(id, true);
    },
  });

  return {
    working(thread) {
      if (!asked.has(thread)) {
        const failed = failedAt.get(thread);
        if (failed === undefined || now() - failed >= RETRY_MS) read(thread);
      }
      return known.get(thread) ?? null;
    },
    refresh() {
      for (const thread of asked) read(thread);
    },
    dispose() {
      disposed = true;
      abort.abort();
      unsubscribe();
    },
  };
}
