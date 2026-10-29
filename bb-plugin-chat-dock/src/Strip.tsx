import { useEffect } from "react";
import { useBbContext } from "@get-bb/plugin-sdk/app";
import { useDebug } from "./debug";
import { adopt, createStripHost, findPanes, holdsShell, isDrawer, moveInto, observePage, onShellHome, overlayFor, panelHidden, type Overlay, type Panel } from "./dom";
import { useOptions } from "./options";

/**
 * Locked mode. For every chat pane on the page whose right panel is open, a host
 * is appended to the panel's column under the tab body (in flow, so the open
 * tab shrinks rather than being covered) and the pane's composer shell moves into
 * it. A collapsed panel, the lock switched off, or leaving the thread puts the
 * shell back. Nothing renders through React: BB owns every element involved.
 *
 * Every check runs from a page-wide mutation observer, so it lands in the same
 * task as BB's own DOM change, before a paint: a shell that mounts with a new
 * thread's column is docked before it is ever drawn in the column, and when BB
 * remounts the panel's column after a plugin setting write, which throws the
 * host out with the shell inside, the host is moved into the fresh column just
 * as invisibly.
 */
export function Strip() {
  const { threadId } = useBbContext();
  const { ready, enabled, locked } = useOptions();
  const log = useDebug();
  const on = threadId !== null && ready && enabled && locked;

  useEffect(() => {
    if (!on) return;
    // `overlay`: in the phone drawer the shell is there, and `host` only keeps its place.
    type Entry = { host: HTMLElement; panel: Panel; restore: () => void; overlay?: Overlay };
    const held = new Map<HTMLElement, Entry>();

    const release = (root: HTMLElement, reason: string) => {
      const entry = held.get(root);
      if (!entry) return;
      held.delete(root);
      entry.host.remove();
      entry.restore();
      entry.overlay?.dispose();
      log.current("undock", { from: "strip", reason });
    };
    const hold = (root: HTMLElement, shell: HTMLElement, panel: Panel) => {
      const host = createStripHost();
      panel.column.appendChild(host);
      const overlay = isDrawer(panel) ? overlayFor(host, panel, "chat-dock-strip") : undefined;
      const restore = moveInto(shell, overlay?.host ?? host);
      held.set(root, { host, panel, restore, overlay });
      log.current("dock", { to: "strip", height: shell.getBoundingClientRect().height });
    };
    // The tab parked the shell in a strip host when the lock went on: take it over.
    const takeOver = (root: HTMLElement, panel: Panel) => {
      const host = root.querySelector<HTMLElement>("[data-chat-dock-host=strip]");
      const restore = host && adopt(host);
      if (!host || !restore) return;
      held.set(root, { host, panel, restore });
      log.current("dock", { to: "strip", adopted: true });
    };
    // The host's column was replaced under it, or it sat in the aside while BB had
    // the panel flat and the column is back: into the right one, shell and all.
    const rehome = (root: HTMLElement, entry: Entry, panel: Panel) => {
      if (entry.host.parentElement === panel.column) return;
      panel.column.appendChild(entry.host);
      entry.panel = panel;
      log.current("rehome", { to: "strip" });
    };
    function check() {
      const panes = findPanes();
      for (const { root, shell, panel } of panes) {
        const entry = held.get(root);
        if (!panel || panelHidden(panel)) {
          if (entry) release(root, "panel closed");
        } else if (entry && shell) {
          // The pane offers a shell in its column while the host holds one: the
          // thread changed under the panel. The held shell is stale and is dropped.
          release(root, "thread changed");
          hold(root, shell, panel);
        } else if (entry) {
          rehome(root, entry, panel);
          if (!holdsShell(entry.overlay?.host ?? entry.host)) release(root, "shell replaced");
        } else if (shell) hold(root, shell, panel);
        else takeOver(root, panel);
      }
      for (const root of [...held.keys()]) {
        if (!panes.some((pane) => pane.root === root)) release(root, "pane gone");
      }
    }
    check();
    const stopObserving = observePage(check);
    const timer = window.setInterval(check, 500);
    const offHome = onShellHome(check);
    return () => {
      offHome();
      stopObserving();
      window.clearInterval(timer);
      for (const root of [...held.keys()]) release(root, "off");
    };
  }, [on, log]);

  return null;
}
