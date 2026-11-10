import { useSyncExternalStore } from "react";

/**
 * The turn counter hangs outside the bar's right edge. Below this scroller width the
 * bar fills the column and the counter would be clipped, so it is left out.
 */
export const COUNTER_ROOM = 840;

let room = true;
const roomListeners = new Set<() => void>();

/**
 * Whether the thread view is wide enough for the counter. The bar, which measures the
 * scroller, reports it here so the thread menu can grey the option out when it
 * cannot apply; both live in the one bundle, so a module variable is the channel.
 */
export function setCounterRoom(next: boolean) {
  if (next === room) return;
  room = next;
  for (const listener of roomListeners) listener();
}

export function useCounterRoom(): boolean {
  return useSyncExternalStore(
    (listener) => {
      roomListeners.add(listener);
      return () => roomListeners.delete(listener);
    },
    () => room,
  );
}

/** Whether any pointer can hover; a phone has none, so there is no tooltip to show. */
export function useCanHover(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia("(any-hover: hover)");
      query.addEventListener("change", listener);
      return () => query.removeEventListener("change", listener);
    },
    () => window.matchMedia("(any-hover: hover)").matches,
  );
}

/** Whether the tab is in view; nothing is read for a bar nobody can see. */
export function useTabVisible(): boolean {
  return useSyncExternalStore(
    (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
    () => !document.hidden,
  );
}
