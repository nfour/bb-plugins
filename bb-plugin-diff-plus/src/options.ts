// The tree's options, kept per browser in localStorage, like its on/off and its
// width. Not plugin settings: every plugin setting write makes BB remount the
// right panel, which would throw away the Diff tab under the menu that set it.
import { useSyncExternalStore } from "react";
import type { OpenDepth } from "./folders";

export interface Options {
  /** Whether the tree is shown beside the list. */
  open: boolean;
  /** How far folders open when a scope's tree first loads. */
  depth: OpenDepth;
  /** Folders, or every file on its own row with its folder beside it. */
  view: "tree" | "list";
  /** Whether a folder holding only one folder shares its row ("src/foo/bar"). */
  compact: boolean;
  /** Synced view: the tree in the list's order, with a line beside the files on screen there. */
  synced: boolean;
  /** With Synced view: the tree scrolls to keep the files on screen in view. */
  syncScroll: boolean;
  /** With Synced view: a bar on the tree's edge beside each file on screen. */
  syncBars: boolean;
  /** Whether the scope picker lists the recent commits. */
  recent: boolean;
  /** How many commits it lists. */
  recentCount: number;
}

export const RECENT_COUNTS = [10, 20, 50] as const;

const KEY = "bb-plugin-diff-plus:options";
/** The on/off choice from before the options, kept so it carries over. */
const OPEN_KEY = "bb-plugin-diff-plus:tree";
const DEFAULTS: Options = { open: true, depth: "all", view: "tree", compact: true, synced: true, syncScroll: false, syncBars: false, recent: true, recentCount: 10 };

const listeners = new Set<() => void>();
let cached: { raw: string | null; legacy: string | null; options: Options } | null = null;

function read(): Options {
  let raw: string | null = null;
  let legacy: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
    legacy = localStorage.getItem(OPEN_KEY);
  } catch {}
  if (cached && cached.raw === raw && cached.legacy === legacy) return cached.options;
  let stored: Partial<Options> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    stored = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Partial<Options>) : {};
  } catch {
    stored = {};
  }
  const options: Options = {
    open: typeof stored.open === "boolean" ? stored.open : legacy ? legacy === "open" : DEFAULTS.open,
    depth: stored.depth === "all" || stored.depth === "none" || stored.depth === "top" ? stored.depth : DEFAULTS.depth,
    view: stored.view === "list" ? "list" : "tree",
    compact: typeof stored.compact === "boolean" ? stored.compact : DEFAULTS.compact,
    synced: typeof stored.synced === "boolean" ? stored.synced : DEFAULTS.synced,
    syncScroll: typeof stored.syncScroll === "boolean" ? stored.syncScroll : DEFAULTS.syncScroll,
    syncBars: typeof stored.syncBars === "boolean" ? stored.syncBars : DEFAULTS.syncBars,
    recent: typeof stored.recent === "boolean" ? stored.recent : DEFAULTS.recent,
    recentCount: RECENT_COUNTS.includes(stored.recentCount as (typeof RECENT_COUNTS)[number]) ? stored.recentCount! : DEFAULTS.recentCount,
  };
  cached = { raw, legacy, options };
  return options;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function setOption<K extends keyof Options>(key: K, value: Options[K]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [key]: value }));
  } catch {}
  for (const listener of listeners) listener();
}

export const useOptions = (): Options => useSyncExternalStore(subscribe, read);
