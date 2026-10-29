import { useEffect, useRef } from "react";
import { useDebug } from "./debug";
import { findPanel, findShell, holdsShell, isDrawer, moveInto, observePanel, onShellHome, overlayFor, panelHidden, park, type Overlay } from "./dom";
import { useOptions } from "./options";

/**
 * The body of the Chat tab. While it is mounted (the tab is the active one in its
 * pane) it holds the chat column's composer shell at its bottom; on unmount, or
 * while the right panel is collapsed, the shell goes back to the column, so a
 * closed panel means the default layout. Locked, the strip holds the shell
 * instead and the tab is not offered, but a tab already open stays out of the way.
 */
export function Dock({ threadId }: { threadId: string }) {
  const host = useRef<HTMLDivElement | null>(null);
  const log = useDebug();
  const { locked } = useOptions();
  const lockedNow = useRef(locked);
  lockedNow.current = locked;

  useEffect(() => {
    const slot = host.current;
    if (!slot || locked) return;
    const where = findPanel(slot);
    let restore: (() => void) | null = null;
    // In the phone drawer the shell sits in an overlay and the slot only keeps its place.
    let overlay: Overlay | null = null;
    const held = () => overlay?.host ?? slot;

    const undock = (reason: string) => {
      if (!restore) return;
      restore();
      restore = null;
      overlay?.dispose();
      overlay = null;
      log.current("undock", { from: "tab", reason });
    };
    // Dock now, and keep docking: the shell can be rebuilt under a thread (a layout
    // change), which leaves the marker behind and a fresh shell in the column.
    const check = () => {
      if (restore && !holdsShell(held())) undock("shell replaced");
      if (where && panelHidden(where)) return undock("panel closed");
      if (restore) return;
      const shell = findShell(threadId);
      if (!shell) return;
      if (where && isDrawer(where)) overlay = overlayFor(slot, where, "chat-dock-tab-host");
      restore = moveInto(shell, held());
      log.current("dock", { to: "tab", height: shell.getBoundingClientRect().height });
    };
    check();
    const timer = window.setInterval(check, 500);
    // The panel collapsing and expanding is an attribute change, so no wait.
    const stop = where ? observePanel(where, check) : () => {};
    // The strip letting go (the lock switched off) is a release to take at once.
    const offHome = onShellHome(check);
    return () => {
      offHome();
      window.clearInterval(timer);
      stop();
      // Leaving because the lock went on: hand the shell to the strip rather than
      // bounce it through the column while the overlay catches up.
      // (Not from the drawer: the strip docks there through its own overlay.)
      const shell = slot.querySelector<HTMLElement>("[data-app-composer]");
      if (restore && shell && lockedNow.current && where && !panelHidden(where)) {
        restore();
        restore = null;
        park(shell, where);
        log.current("undock", { from: "tab", reason: "parked for the strip" });
        return;
      }
      undock("unmount");
    };
  }, [threadId, locked, log]);

  return (
    <div className="chat-dock-tab">
      <div className="chat-dock-tab-space" />
      <div ref={host} data-chat-dock-host="tab" className="chat-dock-tab-host" />
    </div>
  );
}
