import type { Debug } from "./debug";
import { BACKSTOP_MS, createStripHost, type Dock, dockShell, every, findPanel, findPanes, holdsShell, observePage, type Panel, panelHidden } from "./dom";
import { plan, type Want } from "./model";

/**
 * The one place that decides where each chat pane's composer shell is. The
 * strip, the Chat tab and the options only say what they know (`configure`,
 * `registerTab`); `reconcile` looks at the page and, per pane, puts the shell where
 * it belongs: in its column, in a strip under the open tab of its panel, or in the
 * body of the Chat tab. A shell goes from one docking place to the other in a
 * single move, never through the column, so the lock switching is not seen.
 *
 * Every reconcile runs from a page-wide mutation observer, so it lands in the same
 * task as BB's own DOM change, before a paint: a shell that mounts with a new
 * thread's column is docked before it is ever drawn in the column, and when BB
 * remounts the panel's column after a plugin setting write, which throws the
 * host out with the shell inside, the host is moved into the fresh column just
 * as invisibly. A backstop timer covers what the observer cannot see.
 */

interface Inputs {
  /** A thread page is showing. */
  thread: boolean;
  ready: boolean;
  enabled: boolean;
  locked: boolean;
}

interface Held {
  kind: "strip" | "tab";
  /** The strip's host (ours, in the panel's column) or the tab's body. */
  host: HTMLElement;
  panel: Panel;
  dock: Dock;
}

/** A mounted Chat tab: its body, and the panel it was found in (kept for the frames its body is out of the page). */
interface Tab {
  slot: HTMLElement;
  panel: HTMLElement | null;
}

let inputs: Inputs = { thread: false, ready: false, enabled: false, locked: true };
let log: Debug = () => {};
const tabs = new Set<Tab>();
/** What each pane holds, by its layout root. */
const held = new Map<HTMLElement, Held>();
let stop: (() => void) | null = null;

const docking = () => inputs.thread && inputs.ready && inputs.enabled;

/** Takes in what a component knows of the options and the page; reconciles at once. */
export function configure(next: Partial<Inputs>): void {
  inputs = { ...inputs, ...next };
  sync();
}

export function setLog(next: Debug): void {
  log = next;
}

/** A Chat tab mounted: its body is where a pane's shell goes while the lock is off. Returns what unmounts it. */
export function registerTab(slot: HTMLElement): () => void {
  const tab: Tab = { slot, panel: findPanel(slot)?.panel ?? null };
  tabs.add(tab);
  sync();
  return () => {
    tabs.delete(tab);
    for (const [root, entry] of held) if (entry.host === slot) release(root, "tab closed");
    sync();
  };
}

/** Watches the page only while something could be docked: the lock is on, or a Chat tab is mounted. */
function sync(): void {
  const active = docking() && (inputs.locked || tabs.size > 0);
  if (active && !stop) {
    const stopObserving = observePage(reconcile);
    const stopTimer = every(BACKSTOP_MS, reconcile);
    stop = () => {
      stopObserving();
      stopTimer();
    };
  } else if (!active && stop) {
    stop();
    stop = null;
  }
  reconcile();
}

function release(root: HTMLElement, reason: string): void {
  const entry = held.get(root);
  if (!entry) return;
  held.delete(root);
  if (entry.kind === "strip") entry.host.remove();
  entry.dock.restore();
  log("undock", { from: entry.kind, reason });
}

/** The Chat tab whose body is in this panel. */
function tabIn(panel: Panel): Tab | undefined {
  for (const tab of tabs) if ((findPanel(tab.slot)?.panel ?? tab.panel) === panel.panel) return tab;
}

/** Puts every pane's shell where it belongs. */
export function reconcile(): void {
  // A release can put a shell in a column that then belongs in a host again (a drawer BB replaced): look again.
  for (let pass = 0; pass < 3 && reconcileOnce(); pass++);
}

/** One look at the page; whether a shell was released, so that another look may find it a new home. */
function reconcileOnce(): boolean {
  const panes = docking() ? findPanes() : [];
  let released = false;
  for (const { root, shell, panel } of panes) {
    const entry = held.get(root);
    let want: Want = "column";
    let reason = "panel closed";
    let tab: Tab | undefined;
    if (panel && !panelHidden(panel)) {
      if (inputs.locked) want = "strip";
      else if ((tab = tabIn(panel))) want = "tab";
      else reason = "no tab";
    }
    const step = plan({ want, held: entry?.kind ?? null, columnShell: shell !== null, holds: entry ? holdsShell(entry.host) : false });
    if (step === "release") {
      release(root, want === "column" ? reason : "shell replaced");
      released = want !== "column";
    } else if (step === "replace") {
      release(root, "thread changed");
    }
    if (want === "column" || !panel) continue;
    // The host a shell goes to: the Chat tab's body, or a new strip at the bottom of the panel's column.
    const hostFor = () => {
      if (want === "tab" && tab) return tab.slot;
      const host = createStripHost();
      panel.column.appendChild(host);
      return host;
    };
    const kind = want === "tab" ? "tab" : "strip";
    if ((step === "hold" || step === "replace") && shell) {
      const host = hostFor();
      held.set(root, { kind, host, panel, dock: dockShell(shell, host, panel) });
      log("dock", { to: kind, height: shell.getBoundingClientRect().height });
    } else if (step === "move" && entry) {
      // The lock switched: straight from the strip to the tab or back, keeping the shell's place in the column.
      const host = hostFor();
      entry.dock.moveTo(host, panel);
      if (entry.kind === "strip") entry.host.remove();
      held.set(root, { kind, host, panel, dock: entry.dock });
      log("move", { from: entry.kind, to: kind });
    } else if (step === "keep" && entry && kind === "strip" && entry.host.parentElement !== panel.column) {
      // The host's column was replaced under it, or it sat in the aside while BB had
      // the panel flat and the column is back: into the right one, shell and all.
      panel.column.appendChild(entry.host);
      entry.panel = panel;
      log("rehome", { to: "strip" });
    }
  }
  for (const root of [...held.keys()]) {
    if (!panes.some((pane) => pane.root === root)) release(root, docking() ? "pane gone" : "off");
  }
  return released;
}
