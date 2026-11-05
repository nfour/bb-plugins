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

const SHELL = '[data-scroll-footer] [data-app-composer][data-app-composer-role="primary"]';
/** On a phone-width viewport the right panel is this drawer instead, fixed over the page and outside the grid. */
const SHELF = "[data-testid=secondary-panel-shelf]";

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
 * A narrow viewport has one pane and the drawer, which is outside the grid.
 */
export function findPanes(): { root: HTMLElement; shell: HTMLElement | null; panel: Panel | null }[] {
  return [...document.querySelectorAll<HTMLElement>("[data-split-resize-grid-root]")].map((root) => ({
    root,
    shell: root.querySelector<HTMLElement>(SHELL),
    panel: panelFor(root),
  }));
}

/** The right panel of a chat pane: the pane's split panel, or the drawer. */
export function panelFor(root: HTMLElement): Panel | null {
  return findPanel(root.querySelector("#thread-detail-secondary-panel") ?? root) ?? findShelf();
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
  const panel = from.closest<HTMLElement>("#thread-detail-secondary-panel") ?? from.querySelector<HTMLElement>("#thread-detail-secondary-panel");
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
 * mounting its aside), and the attributes that collapse or expand a panel.
 * `onChange` runs in the observer's microtask, after the change and before a
 * paint. Mutations inside the rows and inside the composer itself, which stream
 * constantly, are filtered out before anything is done.
 */
export function observePage(onChange: () => void): () => void {
  const observer = new MutationObserver((records) => {
    if (records.some(({ target }) => !(target instanceof Element) || !target.closest("[data-timeline-items], [data-app-composer]"))) onChange();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-panel-size", "aria-hidden", "inert"] });
  return () => observer.disconnect();
}

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
  const restore = moveInto(shell, host);
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

/** Whether `host` still holds a composer shell (BB can rebuild the shell under a thread, leaving the host empty). */
export function holdsShell(host: HTMLElement): boolean {
  return host.querySelector('[data-app-composer][data-app-composer-role="primary"]') !== null;
}

/** Whether a panel is the phone drawer rather than the split panel. */
export function isDrawer({ panel }: Panel): boolean {
  return panel.matches(SHELF);
}

export interface Overlay {
  /** Where the shell goes: inside BB's React root, laid over the drawer's bottom. */
  host: HTMLElement;
  dispose(): void;
}

/**
 * BB portals the phone drawer outside its React root, and React ignores every
 * event whose target is outside the root it rendered into. A shell moved into
 * the drawer took typing (the editor listens natively) but none of its buttons,
 * and never expanded, so its footer never showed. In the drawer the shell stays
 * inside the root instead, in a fixed host laid over the drawer's bottom, and
 * the place it would have taken in the drawer (`spacer`) keeps the host's
 * height, so nothing in the drawer is covered.
 *
 * Vertically the overlay is the drawer's twin in CSS (`styles.css`): the same
 * `top: 0`, `--bb-shell-height` and bottom safe-area padding. BB shrinks that
 * height to the visual viewport while the on-screen keyboard is up, so the
 * composer rises above the keyboard with the drawer, in the same style pass and
 * with no offset of its own. Horizontally it follows the drawer only while the
 * drawer moves (opening, a drag, a transition), for a bounded run of frames.
 */
export function overlayFor(spacer: HTMLElement, panel: Panel, className: string): Overlay {
  const drawer = panel.panel;
  // A full-height layer that lets touches through, and the frame at its bottom that holds the shell.
  const layer = document.createElement("div");
  layer.className = "chat-dock-overlay";
  layer.style.zIndex = String((Number.parseInt(getComputedStyle(drawer).zIndex, 10) || 45) + 1);
  const host = document.createElement("div");
  host.dataset.chatDockHost = "overlay";
  host.className = `${className} chat-dock-overlay-frame`;
  layer.appendChild(host);
  (document.getElementById("root") ?? document.body).appendChild(layer);
  spacer.dataset.chatDockSpacer = "";

  const place = () => {
    const rect = drawer.getBoundingClientRect();
    layer.style.width = `${rect.width}px`;
    layer.style.translate = `${rect.left}px 0`;
  };
  let frame = 0;
  let until = 0;
  const tick = () => {
    place();
    frame = performance.now() < until ? requestAnimationFrame(tick) : 0;
  };
  const follow = (ms: number) => {
    until = performance.now() + ms;
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const dragging = () => follow(10_000);
  const settled = () => follow(600);
  const moving = () => follow(700);
  drawer.addEventListener("pointerdown", dragging, true);
  window.addEventListener("pointerup", settled, true);
  window.addEventListener("pointercancel", settled, true);
  drawer.addEventListener("transitionrun", moving);
  // The host's height for the spacer; the drawer's size (a rotation, a new viewport) for the host.
  const sized = new ResizeObserver(() => {
    spacer.style.height = `${host.offsetHeight}px`;
    place();
  });
  sized.observe(host);
  sized.observe(drawer);
  place();
  moving();

  return {
    host,
    dispose() {
      cancelAnimationFrame(frame);
      frame = 0;
      sized.disconnect();
      drawer.removeEventListener("pointerdown", dragging, true);
      window.removeEventListener("pointerup", settled, true);
      window.removeEventListener("pointercancel", settled, true);
      drawer.removeEventListener("transitionrun", moving);
      layer.remove();
      delete spacer.dataset.chatDockSpacer;
      spacer.style.height = "";
    },
  };
}
