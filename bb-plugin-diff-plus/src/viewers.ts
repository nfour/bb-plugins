// Who is showing a picked commit, per environment. No React and no DOM here: src/viewers.test.ts runs it.
// A viewer is a function that says whether its Diff tab is still on the page: a tab BB took away (a thread
// switch, a closed panel) can stay mounted in React for a while, and must not count as showing the commit.

export function createViewers() {
  const alive = new Map<string, Set<() => boolean>>();
  return {
    /** Registers a viewer of `environmentId`; returns what to call when it goes. */
    add(environmentId: string, isShowing: () => boolean): () => void {
      const set = alive.get(environmentId) ?? new Set();
      set.add(isShowing);
      alive.set(environmentId, set);
      return () => {
        set.delete(isShowing);
        if (!set.size && alive.get(environmentId) === set) alive.delete(environmentId);
      };
    },
    /** Whether any registered viewer of `environmentId` is still showing. */
    has(environmentId: string): boolean {
      for (const isShowing of alive.get(environmentId) ?? []) if (isShowing()) return true;
      return false;
    },
  };
}
