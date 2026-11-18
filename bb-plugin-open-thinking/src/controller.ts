import type { useSdk } from "@get-bb/plugin-sdk/app";
import {
  chainOf,
  groupLedBy,
  liveScrollBox,
  mayHoldThinking,
  readPane,
  rowToggle,
  rowToggleAt,
  scrollers,
  thinkingRow,
  thinkingToggleAt,
} from "./dom.ts";
import { follow } from "./follow.ts";
import {
  claimLive,
  clickedNow,
  keepOpen,
  LIVE_KEY,
  mayClick,
  newestFresh,
  own,
  plan,
  SETTLE_MS,
  type Clicked,
  type Owned,
  type PaneMemory,
  type Rules,
} from "./model.ts";
import { createStatus } from "./status.ts";

type Sdk = Pick<ReturnType<typeof useSdk>, "subscribe" | "threads">;

/** What the reader has opened or closed, by thread, for the page session. It outlives the controller (a setting write remounts it) and BB's own state. */
const owned: Owned = new Map();

/** Rows that appear within this long of the reader's click are what they unfolded, not new thoughts. */
const READER_MS = 2000;

/**
 * Starts opening (and, by the rules, closing) thinking on every timeline on the page; returns what stops it.
 *
 * One observer on the page root: added nodes that are or hold a row, a scroller or a toggle, and changes to the
 * open state of the toggles that keep the newest thought in view. One realtime subscription for thread status.
 * Both stand down while the tab is in the background and one look on return catches up. The only timer is one
 * short wait after a click, to look again if BB undid it.
 */
export function startController(sdk: Sdk, rules: Rules): () => void {
  /** What each toggle element was last clicked for: it is clicked again only for a different target, or when BB undid the click. */
  const clicked = new WeakMap<HTMLElement, Clicked>();
  const memory = new WeakMap<Element, PaneMemory>();
  /** The toggles whose open state is watched, because the newest thought sits inside them. */
  const watched = new WeakSet<Element>();
  /** The scrolling box of each live line being followed, and what stops it. */
  const followers = new Map<HTMLElement, () => void>();
  const root = document.getElementById("root") ?? document.body;
  let observing = false;
  let readerAt = 0;
  let retry = 0;

  const press = (toggle: HTMLElement, isOpen: boolean, want: boolean, now: number) => {
    const last = clicked.get(toggle);
    if (isOpen === want || !mayClick(last, want, now)) return;
    clicked.set(toggle, clickedNow(last, want, now));
    toggle.click();
    // The state shows a moment after the click; look once more after that in case BB put it back.
    if (!retry) {
      retry = window.setTimeout(() => {
        retry = 0;
        sync();
      }, SETTLE_MS + 50);
    }
  };

  const memoryOf = (scroller: Element): PaneMemory => {
    let one = memory.get(scroller);
    if (!one) memory.set(scroller, (one = { seen: new Set(), known: new Set(), latest: null, liveOwned: false, goneAt: null }));
    return one;
  };

  const sync = () => {
    if (document.hidden) return;
    const now = Date.now();
    for (const [box, stop] of followers) {
      if (box.isConnected) continue;
      stop();
      followers.delete(box);
    }
    for (const scroller of scrollers()) {
      const pane = readPane(scroller);
      const seen = memoryOf(scroller);
      if (pane.entries.length === 0 && !seen.liveOwned && !seen.latest) continue;
      const thread = pane.thread ?? "";
      const claimed = claimLive(seen, pane.entries, now);
      if (claimed) own(owned, thread, claimed);
      const mine = new Set(owned.get(thread));
      if (seen.liveOwned) mine.add(LIVE_KEY);
      const working = pane.thread === null ? null : status.working(pane.thread);

      // The newest thought, and where it sits while it is on the page.
      const fresh = newestFresh(pane.entries, seen.known, now - readerAt < READER_MS);
      for (const entry of pane.entries) seen.known.add(entry.key);
      if (fresh) {
        const row = thinkingRow(scroller, fresh.key);
        seen.latest = { key: fresh.key, chain: row ? chainOf(row) : [] };
      } else if (seen.latest) {
        const row = thinkingRow(scroller, seen.latest.key);
        if (row) seen.latest.chain = chainOf(row);
        else {
          // Folded away: if BB has made it the lead of a group, that group is where it is now.
          const led = groupLedBy(scroller, seen.latest.key);
          if (led && !seen.latest.chain.includes(led)) seen.latest.chain = [...seen.latest.chain, led];
        }
      }

      for (const change of plan({ entries: pane.entries, rules, working, owned: mine })) {
        const toggle = pane.toggles.get(change.key);
        const entry = pane.entries.find((one) => one.key === change.key);
        if (toggle && entry) press(toggle, entry.open, change.open, now);
      }

      if (rules.keepLatest && seen.latest) {
        const rows = new Map<string, { toggle: HTMLElement; open: boolean }>();
        for (const id of seen.latest.chain) {
          const found = rowToggle(scroller, id);
          if (!found) continue;
          rows.set(id, found);
          watched.add(found.toggle);
        }
        const present = new Map([...rows].map(([id, found]) => [id, found.open]));
        for (const id of keepOpen({ chain: seen.latest.chain, present, owned: mine, working })) {
          const found = rows.get(id);
          if (found) press(found.toggle, found.open, true, now);
        }
      }

      const live = pane.toggles.get(LIVE_KEY);
      const box = rules.followGrowth && live ? liveScrollBox(live) : null;
      if (box && !followers.has(box)) followers.set(box, follow(box));
    }
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        if (watched.has(record.target as Element)) return sync();
        continue;
      }
      for (const node of record.addedNodes) if (mayHoldThinking(node)) return sync();
    }
  });
  const observe = () => {
    if (observing) return;
    observing = true;
    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-expanded"] });
  };
  const unobserve = () => {
    observing = false;
    observer.disconnect();
  };

  const status = createStatus(sdk, sync);

  /** A click the reader made on a toggle: theirs from now on. The plugin's own `click()` is not trusted. */
  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted) return;
    readerAt = Date.now();
    const hit = thinkingToggleAt(event.target);
    if (hit) {
      if (!hit.live) own(owned, hit.thread, hit.key);
      else if (hit.scroller) {
        const seen = memory.get(hit.scroller);
        if (seen) seen.liveOwned = true;
      }
      return;
    }
    // A group the reader closes is not reopened to keep the newest thought in view.
    const row = rowToggleAt(event.target);
    if (row) own(owned, row.thread, row.key);
  };
  const onVisibility = () => {
    if (document.hidden) unobserve();
    else {
      observe();
      sync();
    }
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("visibilitychange", onVisibility);
  if (!document.hidden) observe();
  sync();

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("visibilitychange", onVisibility);
    unobserve();
    window.clearTimeout(retry);
    for (const stop of followers.values()) stop();
    followers.clear();
    status.dispose();
  };
}
