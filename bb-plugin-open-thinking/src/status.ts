import type { useSdk } from "@get-bb/plugin-sdk/app";

type Sdk = Pick<ReturnType<typeof useSdk>, "subscribe" | "threads">;

/** The thread statuses in which a turn is still going or about to. */
const RUNNING = new Set(["active", "starting", "stopping", "pending"]);

export function isRunning(status: string): boolean {
  return RUNNING.has(status);
}

export interface Status {
  /** Whether the thread is working, or `null` until it is known (one read is under way). */
  working(thread: string): boolean | null;
  dispose(): void;
}

/**
 * Whether each thread on the page is working. A thread is read once the first time it is asked about; after that
 * its realtime `status-changed` signals carry the status. Nothing is read for threads that are not on the page.
 */
export function createStatus(sdk: Sdk, onChange: () => void): Status {
  const known = new Map<string, boolean>();
  const asked = new Set<string>();
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
  const read = (thread: string) => {
    asked.add(thread);
    signalled.delete(thread);
    sdk.threads.get({ threadId: thread, signal: abort.signal }).then(
      (found) => {
        if (!signalled.has(thread)) set(thread, isRunning(found.status));
      },
      // Asked again on the next look at the page.
      () => asked.delete(thread),
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
      } else read(id);
    },
  });

  return {
    working(thread) {
      if (!asked.has(thread)) read(thread);
      return known.get(thread) ?? null;
    },
    dispose() {
      disposed = true;
      abort.abort();
      unsubscribe();
    },
  };
}
