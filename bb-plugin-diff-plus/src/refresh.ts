// When the tree reads the changed files again. No React and no SDK here, so src/refresh.test.ts runs it.

/**
 * Environment changes that can change which files differ. "work-status-changed" is the one a
 * file written, reverted or discarded in the working tree raises (BB's own Diff tab refreshes
 * on it too); "git-refs-changed" a commit, "status-changed" and "metadata-changed" the rest.
 */
export const REFRESH_ON: ReadonlySet<string> = new Set(["work-status-changed", "status-changed", "git-refs-changed", "metadata-changed"]);

export const refreshes = (changes: readonly string[]) => changes.some((change) => REFRESH_ON.has(change));

/**
 * Runs `run` once things have been quiet for `wait` ms, but at most `maxWait` ms after the first
 * signal: an agent writing files all the time never lets it go quiet, and the list must still move.
 * Uses the global timers, so tests can mock them.
 */
export function refresher(run: () => void, wait: number, maxWait: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let first = 0;
  return {
    signal() {
      const now = Date.now();
      if (timer === undefined) first = now;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        run();
      }, Math.max(0, Math.min(wait, first + maxWait - now)));
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
