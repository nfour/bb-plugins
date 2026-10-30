// BB's Diff tab as the folder tree finds and drives it. None of this is an SDK
// contract: it is bb-app 0.47.1's markup (checked again on 0.48.1), so a BB
// update can move it, and then the tree simply does not show (findDiffTabs
// finds nothing).
//
//   [data-testid=git-diff-toolbar-layout]     scope picker, summary, actions
//     [data-testid=git-diff-toolbar-selector-slot] button   "All changes", "Committed changes", "<sha> <subject>"
//     [data-testid=git-diff-toolbar-actions]  Search filenames, Filter files, Collapse all, Diff settings
//   (its wrapper's next sibling)              the box around the file list's scroller
//
// The filter box ("Search filenames") takes globs: `docs/**`, `*.md`, `!*.test.ts`.
//
// The "Filter files" menu (extensions, deleted, viewed) is not in the markup
// while closed. bb--git keeps its choices in a module of its own, per
// environment, and hands them to the toolbar as its `filters` prop, so
// readFilters takes them from the toolbar's React fiber.

import type { DiffFilters } from "./folders";

export interface DiffTab {
  /** The toolbar's wrapper; the filter box appears inside it. */
  toolbar: HTMLElement;
  /** The toolbar's action buttons; the tree's toggle goes first. */
  actions: HTMLElement;
  /** The box around the file list's scroller; the tree column goes in it, before the list. */
  list: HTMLElement;
  /** The thread pane the tab belongs to, if it is in one. */
  pane: Element | null;
}

const LAYOUT = '[data-testid="git-diff-toolbar-layout"]';
const ACTIONS = '[data-testid="git-diff-toolbar-actions"]';
const SCOPE = '[data-testid="git-diff-toolbar-selector-slot"] button';
const FILTER = 'input[aria-label="Filter changed files by path"]';
/** A file card's "Viewed" checkbox (a Radix checkbox). */
export const VIEWED_BOX = '[role="checkbox"][aria-label^="Viewed "]';
const OPEN_SEARCH = 'button[aria-label="Search filenames"]';
const CLOSE_SEARCH = 'button[aria-label="Close filename search"]';

export function findDiffTabs(): DiffTab[] {
  const tabs: DiffTab[] = [];
  for (const layout of document.querySelectorAll<HTMLElement>(LAYOUT)) {
    const toolbar = layout.parentElement?.parentElement;
    const actions = layout.querySelector<HTMLElement>(ACTIONS);
    const list = toolbar?.nextElementSibling;
    if (!toolbar || !actions || !(list instanceof HTMLElement)) continue;
    tabs.push({ toolbar, actions, list, pane: toolbar.closest("[data-split-resize-grid-root]") });
  }
  return tabs;
}

/** The thread whose rows are in the tab's pane, when the pane shows a timeline. */
export function paneThread(tab: DiffTab): string | null {
  const row = tab.pane?.querySelector("[data-timeline-row-id]");
  const id = row?.getAttribute("data-timeline-row-id");
  return id ? id.slice(0, id.indexOf(":")) || null : null;
}

/** The scope picker's label, sha and subject joined by a space for a commit. */
export function scopeLabel(tab: DiffTab): string {
  const button = tab.toolbar.querySelector(SCOPE);
  if (!button) return "";
  const parts = [...button.querySelectorAll("span span")].map((span) => span.textContent?.trim() ?? "");
  return (parts.length ? parts.join(" ") : (button.textContent ?? "")).trim();
}

/** The scope picker's button. */
export const scopeTrigger = (tab: DiffTab) => tab.toolbar.querySelector<HTMLElement>(SCOPE);

/** The scope picker's menu (a Radix menu, portalled to the body) while it is open. */
export function pickerMenu(tab: DiffTab): HTMLElement | null {
  const trigger = scopeTrigger(tab);
  if (!trigger?.id || trigger.getAttribute("data-state") !== "open") return null;
  return document.querySelector<HTMLElement>(`[role="menu"][aria-labelledby="${CSS.escape(trigger.id)}"]`);
}

export interface PickerItem {
  element: HTMLElement;
  kind: "all" | "uncommitted" | "committed" | "commit";
  /** A commit's short sha. */
  sha: string | null;
}

const KINDS: Record<string, PickerItem["kind"]> = {
  "All changes": "all",
  "Uncommitted changes": "uncommitted",
  "Committed changes": "committed",
};

/** The picker's own items, read from each one's title ("All changes", "<short sha> <subject>"). */
export function pickerItems(menu: HTMLElement): PickerItem[] {
  return [...menu.querySelectorAll<HTMLElement>(':scope > [role="menuitem"]:not([data-diff-plus-row])')].map((element) => {
    const title = element.querySelector("[title]")?.getAttribute("title") ?? "";
    const kind = KINDS[title];
    return kind ? { element, kind, sha: null } : { element, kind: "commit", sha: title.split(" ")[0] || null };
  });
}

export function filterValue(tab: DiffTab): string {
  return tab.toolbar.querySelector<HTMLInputElement>(FILTER)?.value ?? "";
}

interface Fiber {
  return: Fiber | null;
  memoizedProps?: { filters?: unknown } | null;
}

const isFilters = (value: unknown): value is { selectedExtensions: string[]; showDeleted: boolean; showViewed: boolean } => {
  const filters = value as Record<string, unknown> | null;
  return (
    typeof filters === "object" &&
    filters !== null &&
    Array.isArray(filters.selectedExtensions) &&
    filters.selectedExtensions.every((ext) => typeof ext === "string") &&
    typeof filters.showDeleted === "boolean" &&
    typeof filters.showViewed === "boolean"
  );
};

/** The tab's "Filter files" choices; null when they cannot be read, and the tree then shows every file. */
export function readFilters(tab: DiffTab): DiffFilters | null {
  const key = Object.keys(tab.actions).find((name) => name.startsWith("__reactFiber$"));
  let fiber = key ? ((tab.actions as unknown as Record<string, Fiber | undefined>)[key] ?? null) : null;
  for (let depth = 0; fiber && depth < 40; depth++, fiber = fiber.return) {
    const filters = fiber.memoizedProps?.filters;
    if (isFilters(filters))
      return { extensions: filters.selectedExtensions, showDeleted: filters.showDeleted, showViewed: filters.showViewed };
  }
  return null;
}

export const filtersKey = (filters: DiffFilters | null) =>
  filters ? `${filters.extensions.join(",")}|${filters.showDeleted}|${filters.showViewed}` : "";

export const isFilterInput = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement && target.matches(FILTER);

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** Waits up to `frames` frames for `find` to return something. */
async function waitFor<T>(find: () => T | null | undefined, frames = 20): Promise<T | null> {
  for (let i = 0; i < frames; i++) {
    const found = find();
    if (found) return found;
    await nextFrame();
  }
  return find() ?? null;
}

/**
 * Types `value` into BB's filter box, opening it if it is closed. An empty value
 * closes the box, which clears the filter. The box is a React input, so the
 * value goes through the native setter and an `input` event, as typing would.
 */
export async function setFilter(tab: DiffTab, value: string): Promise<boolean> {
  let input = tab.toolbar.querySelector<HTMLInputElement>(FILTER);
  if (!value) {
    if (input) tab.actions.querySelector<HTMLElement>(CLOSE_SEARCH)?.click();
    return true;
  }
  if (!input) {
    tab.actions.querySelector<HTMLElement>(OPEN_SEARCH)?.click();
    input = await waitFor(() => tab.toolbar.querySelector<HTMLInputElement>(FILTER));
    if (!input) return false;
  }
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

/** The file list's scroller: the first scrolling box in the list's box that is not the tree's. */
export function listScroller(tab: DiffTab): HTMLElement | null {
  for (const element of tab.list.querySelectorAll<HTMLElement>("div")) {
    if (element.closest(".diff-plus-tree")) continue;
    const { overflowY } = getComputedStyle(element);
    if (overflowY === "auto" || overflowY === "scroll") return element;
  }
  return null;
}

/** Scrolls the file list back to its first card, where a new filter's matches start. */
export function scrollListToTop(tab: DiffTab): void {
  const scroller = listScroller(tab);
  if (scroller) scroller.scrollTop = 0;
}

/**
 * Where the reader is in the file list: the card at the list's top edge, by its
 * path, and how far into it. The list is virtualized (cards are absolutely placed
 * `[data-index]` rows, mounted near the view) and a card's height changes as its
 * patch loads, so a bare scrollTop would land elsewhere after a remount.
 */
export interface ListPlace {
  scrollTop: number;
  path: string | null;
  offset: number;
}

/** A card's path, from its open/close button ("Expand <path>" / "Collapse <path>"). */
function cardPath(card: Element): string | null {
  for (const button of card.querySelectorAll("button[aria-label]")) {
    const label = button.getAttribute("aria-label") ?? "";
    const match = /^(?:Expand|Collapse) (.+)$/.exec(label);
    if (match) return match[1]!;
  }
  return null;
}

/**
 * Calls `onPaths` with the paths of the file cards on screen in the tab's list,
 * in list order, whenever that set changes. The list is virtualized: its
 * scroller holds one box whose children are the mounted cards (`[data-index]`).
 * An IntersectionObserver rooted at the scroller says which are on screen, so a
 * scroll costs the plugin nothing until a card enters or leaves the view. Cards
 * are handed to it as BB mounts them, seen by watching only the box's own
 * children (not what renders inside a card); one-level watches on the list box,
 * the scroller's wrapper and the scroller notice BB replacing any of them.
 */
export function watchVisibleCards(tab: DiffTab, onPaths: (paths: readonly string[]) => void): () => void {
  const paths = new WeakMap<Element, string | null>();
  const onScreen = new Set<Element>();
  let io: IntersectionObserver | null = null;
  let last = "";
  const report = () => {
    const seen = [...onScreen]
      .filter((card) => card.isConnected)
      .sort((a, b) => Number(a.getAttribute("data-index")) - Number(b.getAttribute("data-index")))
      .map((card) => {
        let path = paths.get(card);
        if (path === undefined) paths.set(card, (path = cardPath(card)));
        return path;
      })
      .filter((path): path is string => path !== null);
    const key = seen.join("\n");
    if (key === last) return;
    last = key;
    onPaths(seen);
  };
  const cards = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node instanceof Element && node.hasAttribute("data-index")) io?.observe(node);
      for (const node of record.removedNodes) if (node instanceof Element) onScreen.delete(node);
    }
    report();
  });
  const attach = () => {
    io?.disconnect();
    cards.disconnect();
    onScreen.clear();
    const scroller = listScroller(tab);
    const box = scroller?.querySelector("[data-index]")?.parentElement ?? scroller?.firstElementChild ?? null;
    // The list box and its children (the scroller's wrapper, also while it
    // still shows a loading state), and the scroller.
    structure.observe(tab.list, { childList: true });
    for (const child of tab.list.children) if (!child.matches(".diff-plus-tree")) structure.observe(child, { childList: true });
    if (scroller) structure.observe(scroller, { childList: true });
    if (!scroller || !box) return report();
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) onScreen.add(entry.target);
          else onScreen.delete(entry.target);
        }
        report();
      },
      { root: scroller },
    );
    for (const card of box.children) if (card.hasAttribute("data-index")) io.observe(card);
    cards.observe(box, { childList: true });
  };
  const structure = new MutationObserver((records) => {
    if (records.every((record) => record.target instanceof Element && record.target.closest(".diff-plus-tree"))) return;
    structure.disconnect();
    attach();
  });
  attach();
  return () => {
    io?.disconnect();
    cards.disconnect();
    structure.disconnect();
  };
}

export function readListPlace(scroller: HTMLElement): ListPlace {
  const top = scroller.getBoundingClientRect().top;
  for (const card of scroller.querySelectorAll<HTMLElement>("[data-index]")) {
    const rect = card.getBoundingClientRect();
    if (rect.top <= top + 1 && rect.bottom > top + 1) {
      return { scrollTop: scroller.scrollTop, path: cardPath(card), offset: top - rect.top };
    }
  }
  return { scrollTop: scroller.scrollTop, path: null, offset: 0 };
}

/**
 * Puts the list back at `place`: the saved scrollTop first, which mounts the cards
 * around it, then the saved card at the saved depth, again each frame while the
 * cards above it are still being measured. Resolves when it holds still, after a
 * second at most, or when `cancelled` says the reader took over.
 */
export async function restoreListPlace(tab: DiffTab, place: ListPlace, cancelled: () => boolean): Promise<void> {
  const scroller = await waitFor(() => listScroller(tab));
  if (!scroller) return;
  scroller.scrollTop = place.scrollTop;
  if (!place.path) return;
  let still = 0;
  for (let frame = 0; frame < 60 && still < 6; frame++) {
    await nextFrame();
    if (cancelled()) return;
    const card = [...scroller.querySelectorAll<HTMLElement>("[data-index]")].find((row) => cardPath(row) === place.path);
    if (!card) continue;
    const delta = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top + place.offset;
    if (Math.abs(delta) < 1) still++;
    else {
      still = 0;
      scroller.scrollTop += delta;
    }
  }
}

/** Opens the file's card in the list once the filter has brought it in. */
export async function expandFile(tab: DiffTab, path: string): Promise<void> {
  const button = await waitFor(() =>
    [...tab.list.querySelectorAll<HTMLElement>("button[aria-label]")].find((b) => {
      if (b.closest(".diff-plus-tree")) return false;
      const label = b.getAttribute("aria-label");
      return label === `Expand ${path}` || label === `Collapse ${path}`;
    }),
  );
  if (button?.getAttribute("aria-label") === `Expand ${path}`) button.click();
}

/**
 * Calls `onChange` when a Diff tab may have appeared, gone, or changed scope.
 * BB keeps the right panel's element across navigation and remounts what is
 * inside it, so the observer watches the panels (found again every second) and
 * skips changes inside a tab's file list, where scrolling mounts and unmounts
 * cards all the time. The filter menu is portalled outside the panel, and a
 * pick there may change nothing else in the panel (".css" for ".json", one file
 * each), so its checkmarks (`aria-checked`) are watched page-wide too.
 */
export function watchDiffTabs(onChange: () => void, lists: () => readonly HTMLElement[]): () => void {
  const observed = new Set<Element>();
  const observer = new MutationObserver((records) => {
    const inside = lists();
    if (records.some((record) => !inside.some((list) => list.contains(record.target)))) onChange();
  });
  const attach = () => {
    for (const panel of document.querySelectorAll("#thread-detail-secondary-panel, [data-testid=secondary-panel-shelf]")) {
      if (observed.has(panel)) continue;
      observed.add(panel);
      observer.observe(panel, { childList: true, subtree: true, characterData: true });
    }
    for (const panel of observed) if (!panel.isConnected) observed.delete(panel);
  };
  attach();
  const picks = new MutationObserver(onChange);
  picks.observe(document.body, { attributes: true, attributeFilter: ["aria-checked"], subtree: true });
  const timer = setInterval(() => {
    const before = observed.size;
    attach();
    if (observed.size !== before) onChange();
  }, 1000);
  return () => {
    clearInterval(timer);
    observer.disconnect();
    picks.disconnect();
  };
}
