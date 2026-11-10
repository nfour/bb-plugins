import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

/** Opens or closes the settings panel. The menu item and the panel live in one bundle, so a module variable is the channel. */
export function setPanelOpen(next: boolean) {
  if (next === open) return;
  open = next;
  for (const listener of listeners) listener();
}

export function usePanelOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
