/**
 * BB's thread page DOM, as found in bb-app 0.47.1. Undocumented: see AGENTS.md.
 *
 * A thread page is a horizontal split: `#thread-detail-timeline-panel` (the chat
 * column) beside `#thread-detail-secondary-panel` (the right panel), both under
 * one `[data-split-resize-grid-root]`; a split view has one such root per chat
 * pane. The chat column's scroller ends in a footer stuck to its bottom holding the "Scroll
 * to latest" button and the composer shell, `[data-app-composer]`, which holds
 * the cards above the box (running commands, child threads, questions), the
 * context row (changed files, merge base), the box itself and the chips under
 * it. The turns are a sibling of the footer, so the shell is exactly the
 * non-turn UI.
 */

import { createOverlay, overlayOf } from "./overlay";

const SHELL = '[data-scroll-footer] [data-app-composer][data-app-composer-role="primary"]';
/** On a phone-width viewport the right panel is this drawer instead, pinned over the page and outside the split layout. */
const SHELF = "[data-testid=secondary-panel-shelf]";
/**
 * The right panel: `#thread-detail-secondary-panel`, or in a split workspace
 * `#thread-detail-secondary-panel-<pane id>` (one panel, which moves to the
 * focused pane). The `-handle` element beside it is not a panel.
 */
const PANEL = '#thread-detail-secondary-panel, [id^="thread-detail-secondary-panel-pane"]';
const PANEL_PREFIX = "thread-detail-secondary-panel-";

export interface Panel {
  /** The split panel, or the drawer on a narrow viewport. */
  panel: HTMLElement;
  aside: HTMLElement;
  /** The aside's column: the tab strip, then the tab body. A strip appended here sits under the body. */
  column: HTMLElement;
}

/** The composer shell of the chat column that shows `threadId`, or null while it has not mounted. */
export function findShell(threadId: string): HTMLElement | null {
  const row = document.querySelector(`[data-timeline-row-id^="${CSS.escape(threadId)}:"]`);
  const scroller = row?.closest<HTMLElement>("[data-page-scroll-viewport]");
  return scroller?.querySelector<HTMLElement>(SHELL) ?? null;
}

/**
 * The chat panes on the page, each with its composer shell and its right panel.
 * A narrow viewport has one pane and the drawer, which is outside the split layout.
 */
export function findPanes(): { root: HTMLElement; shell: HTMLElement | null; panel: Panel | null }[] {
  return [...document.querySelectorAll<HTMLElement>("[data-split-resize-grid-root]")].map((root) => {
    const panel = panelFor(root);
    return { root, shell: shellFor(root, panel), panel };
  });
}

/**
 * The composer shell in a layout root's column. Split, the roots nest and the
 * one panel belongs to the pane its id names, so it is that pane's shell, not
 * the first one in the root.
 */
function shellFor(root: HTMLElement, panel: Panel | null): HTMLElement | null {
  const id = panel?.panel.id.startsWith(PANEL_PREFIX) ? panel.panel.id.slice(PANEL_PREFIX.length) : null;
  if (id === null) return root.querySelector<HTMLElement>(SHELL);
  for (const pane of root.querySelectorAll(`[data-split-pane-id="${CSS.escape(id)}"]`)) {
    // The panel's own tabs are split panes with ids of their own, inside the panel.
    if (!pane.closest(PANEL)) return pane.querySelector<HTMLElement>(SHELL);
  }
  return null;
}

/** The right panel of a chat pane: the pane's split panel, or the drawer. */
export function panelFor(root: HTMLElement): Panel | null {
  return findPanel(root.querySelector(PANEL) ?? root) ?? findShelf();
}

/** The drawer while it is open: closed, BB unmounts its aside, so there is nothing to dock into. */
function findShelf(): Panel | null {
  const shelf = document.querySelector<HTMLElement>(SHELF);
  return shelf ? panelOf(shelf, shelf.querySelector<HTMLElement>("aside")) : null;
}

/**
 * The right panel this element is in or holds, or null outside one. The column
 * is the aside's child that wraps the tab strip; while BB remounts the panel the
 * strip and the body sit flat under the aside for a frame or two, and then the
 * aside itself is the column, so a host appended to it still lands at the bottom.
 */
export function findPanel(from: Element): Panel | null {
  const shelf = from.closest<HTMLElement>(SHELF);
  if (shelf) return panelOf(shelf, shelf.querySelector<HTMLElement>("aside"));
  const panel = from.closest<HTMLElement>(PANEL) ?? from.querySelector<HTMLElement>(PANEL);
  return panel ? panelOf(panel, panel.querySelector<HTMLElement>(":scope > aside")) : null;
}

function panelOf(panel: HTMLElement, aside: HTMLElement | null): Panel | null {
  if (!aside) return null;
  const strip = lowestStrip(aside);
  const column = strip ? columnOf(aside, strip) : aside.firstElementChild;
  return column instanceof HTMLElement ? { panel, aside, column } : null;
}

/**
 * The tab strip of the panel's bottom tile. Split, the panel holds one tile per
 * pane (`[data-split-pane-id]`, absolutely placed, in creation order rather than
 * screen order), so the tile is picked by where it sits: lowest, then leftmost.
 */
function lowestStrip(aside: HTMLElement): Element | null {
  const strips = aside.querySelectorAll("[data-testid=thread-secondary-panel-top-chrome]");
  if (strips.length < 2) return strips[0] ?? null;
  let best: Element | null = null;
  let bottom = -Infinity;
  let left = Infinity;
  for (const strip of strips) {
    const rect = (strip.closest("[data-split-pane-id]") ?? strip).getBoundingClientRect();
    const lower = rect.bottom > bottom + 1;
    if (lower || (rect.bottom > bottom - 1 && rect.left < left)) {
      best = strip;
      bottom = lower ? rect.bottom : Math.max(bottom, rect.bottom);
      left = rect.left;
    }
  }
  return best;
}

/** The lowest ancestor of the tab strip (the aside at most) that holds something beside it: the body. */
function columnOf(aside: HTMLElement, strip: Element): HTMLElement {
  let node: Element = strip;
  while (node !== aside) {
    const parent = node.parentElement;
    if (!parent) return aside;
    for (const child of parent.children) {
      if (child !== node && !(child instanceof HTMLElement && child.dataset.chatDockHost)) return parent;
    }
    node = parent;
  }
  return aside;
}

/**
 * Whether the right panel is collapsed: BB sizes the split panel to 0 and hides
 * its aside from assistive technology; the drawer is made inert while closed.
 */
export function panelHidden({ panel, aside }: Panel): boolean {
  const size = Number.parseFloat(panel.dataset.panelSize ?? "");
  return panel.hasAttribute("inert") || aside.getAttribute("aria-hidden") === "true" || (Number.isFinite(size) && size <= 0);
}

/** Watches the attributes that flip when the panel collapses or expands. */
export function observePanel({ panel, aside }: Panel, onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(panel, { attributes: true, attributeFilter: ["data-panel-size", "inert"] });
  observer.observe(aside, { attributes: true, attributeFilter: ["aria-hidden"] });
  return () => observer.disconnect();
}

/**
 * Watches the whole page for what can change where a shell belongs: a chat
 * column or a panel column mounting or being replaced (a navigation, BB's
 * remount of the aside's content after a plugin setting write, the drawer
 * mounting its aside), and the attributes that open or close a panel.
 * `onChange` runs in the observer's microtask, after the change and before a
 * paint. Mutations inside the rows and inside the composer itself, which stream
 * constantly, are filtered out before anything is done.
 */
export function observePage(onChange: () => void): () => void {
  const observer = new MutationObserver((records) => {
    if (records.some(structural)) onChange();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-panel-size", "aria-hidden", "inert"] });
  return () => observer.disconnect();
}

/** What moves a shell's home when it is added or removed: a layout root, a column, a panel, the shell, our own host. */
const STRUCTURE = `[data-split-resize-grid-root], [data-scroll-footer], [data-app-composer], [data-chat-dock-host], [data-split-pane-id], [data-testid=thread-secondary-panel-top-chrome], aside, ${PANEL}, ${SHELF}`;

/**
 * Whether a mutation can change where a shell belongs. A panel's own tab (a diff,
 * a terminal, a browser) changes constantly and none of it matters, so a change
 * of children counts only if a node added or removed is, or holds, a piece of the
 * layout above; an attribute counts only on a panel, a drawer or an aside.
 */
function structural({ type, target, addedNodes, removedNodes }: MutationRecord): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-timeline-items], [data-app-composer]")) return false;
  if (type === "attributes") return target.matches(`aside, ${PANEL}, ${SHELF}`);
  for (const list of [addedNodes, removedNodes]) {
    for (const node of list) if (node instanceof Element && (node.matches(STRUCTURE) || node.querySelector(STRUCTURE))) return true;
  }
  return false;
}

/** The state name of a tab on screen, split: the whole word is a utility to the build. */
const ON_SCREEN = ["vis", "ible"].join("");
const asleep = () => document.visibilityState !== ON_SCREEN;

/**
 * A backstop timer for what the observers miss. It sleeps while the tab is in
 * the background and runs once when the tab comes back.
 */
export function every(ms: number, run: () => void): () => void {
  const timer = window.setInterval(() => {
    if (!asleep()) run();
  }, ms);
  const back = () => {
    if (!asleep()) run();
  };
  document.addEventListener("visibilitychange", back);
  return () => {
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", back);
  };
}

/** How often the backstop timers run. The observers do the work; this is for a change they cannot see. */
export const BACKSTOP_MS = 2000;

/** The strip's host: appended to the panel's column, under the tab body. */
export function createStripHost(): HTMLElement {
  const host = document.createElement("div");
  host.dataset.chatDockHost = "strip";
  host.className = "chat-dock-strip";
  return host;
}

const parked = new Map<HTMLElement, { restore: () => void; timer: number }>();

/**
 * The lock switched on while the tab held the shell. The tab's React root learns
 * of the setting before the overlay's does, so rather than put the shell back in
 * the column for that gap, the tab parks it in a strip host for the strip to
 * adopt. A host nobody adopts in time puts the shell back itself.
 */
export function park(shell: HTMLElement, panel: Panel): void {
  const host = createStripHost();
  panel.column.appendChild(host);
  const restore = dockInto(shell, host, panel);
  const timer = window.setTimeout(() => {
    parked.delete(host);
    host.remove();
    restore();
  }, 1500);
  parked.set(host, { restore, timer });
}

/** Takes over a parked host, returning what puts its shell back; null for a host that is not parked. */
export function adopt(host: HTMLElement): (() => void) | null {
  const entry = parked.get(host);
  if (!entry) return null;
  parked.delete(host);
  window.clearTimeout(entry.timer);
  return entry.restore;
}

const homeListeners = new Set<() => void>();

/**
 * Runs after a shell is put back in its column, in a microtask, so the other
 * dock can take it before anything paints: the tab and the strip never hold a
 * shell at the same time, and a switch between them is one move, not two.
 */
export function onShellHome(listener: () => void): () => void {
  homeListeners.add(listener);
  return () => {
    homeListeners.delete(listener);
  };
}

/**
 * Moves `shell` into `host`, and returns the function that puts it back where it
 * was. A comment marks the place, so the move survives siblings coming and going.
 * A marker with no parent means BB tore the shell's home down (a navigation to
 * another thread unmounts the chat column but keeps the panel, so a docked shell
 * is never removed by React): the shell is stale, and is dropped instead.
 */
export function moveInto(shell: HTMLElement, host: HTMLElement): () => void {
  const marker = document.createComment("chat-dock: composer shell home");
  shell.parentNode?.insertBefore(marker, shell);
  host.appendChild(shell);
  return () => {
    if (marker.parentNode) marker.parentNode.insertBefore(shell, marker);
    else shell.remove();
    marker.remove();
    queueMicrotask(() => {
      for (const listener of homeListeners) listener();
    });
  };
}

/** Whether a panel is the phone drawer rather than the split panel. */
export function isDrawer({ panel }: Panel): boolean {
  return panel.matches(SHELF);
}

/**
 * Docks `shell` in `host`, and returns what puts it back. In the split panel
 * that is `moveInto`; in the phone drawer, which is outside BB's React root,
 * the shell goes into an overlay laid over the host instead (`overlay.ts`).
 */
export function dockInto(shell: HTMLElement, host: HTMLElement, panel: Panel | null): () => void {
  if (!panel || !isDrawer(panel)) return moveInto(shell, host);
  const overlay = createOverlay(host, panel.panel);
  const restore = moveInto(shell, overlay.frame);
  return () => {
    restore();
    overlay.dispose();
  };
}

/**
 * The composer shell `host` holds, or null (BB can rebuild the shell under a
 * thread, leaving the host empty). A drawer's host holds it in its overlay; one
 * whose drawer BB replaced counts as empty, so it is docked again over the new one.
 */
export function heldShell(host: HTMLElement): HTMLElement | null {
  const overlay = overlayOf(host);
  if (overlay && !overlay.live()) return null;
  return (overlay?.frame ?? host).querySelector<HTMLElement>('[data-app-composer][data-app-composer-role="primary"]');
}

/** Whether `host` still holds a composer shell. */
export function holdsShell(host: HTMLElement): boolean {
  return heldShell(host) !== null;
}
