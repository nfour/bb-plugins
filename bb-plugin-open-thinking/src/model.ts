/**
 * The rules, with no page and no SDK in them. A thinking entry is one "Thought" row or the live
 * "Thinking…" line; the page code (`dom.ts`) turns what is on screen into `Entry` values, and
 * `plan` says which of them to click.
 */

/** The key the live "Thinking…" line goes by: it has no id on the page. */
export const LIVE_KEY = "live";

export interface Entry {
  /** The row's id, or `LIVE_KEY` for the live line. */
  key: string;
  open: boolean;
  /** The live "Thinking…" line, not a row yet. */
  live: boolean;
  /** Inside a finished turn's "Worked for" row. */
  folded: boolean;
  /** The turn the row belongs to, from its id. */
  turn: string | null;
}

export interface Rules {
  autoExpand: boolean;
  closeOnNew: boolean;
  closeOnFinish: boolean;
  /** While the turn works, keep the group holding the newest thought open. */
  keepLatest: boolean;
  /** Scroll a thought that outgrows its box to its end, unless the reader scrolled up. */
  followGrowth: boolean;
}

export interface Change {
  key: string;
  /** Whether the entry should end up open. */
  open: boolean;
}

/** The thread a row id starts with. */
export function threadOf(id: string): string | null {
  const at = id.indexOf(":");
  return at > 0 ? id.slice(0, at) : null;
}

/**
 * Whether a row id is a thinking row. A work group's id holds its first child's id after
 * `work-summary:`, so the check is on what directly follows the thread id, not on a substring.
 */
export function isThinkingId(id: string): boolean {
  const thread = threadOf(id);
  return thread !== null && id.startsWith("op:reasoning:", thread.length + 1);
}

/** The turn a thinking row's id names. */
export function turnOf(id: string): string | null {
  return /\|turn:([^|]+)/.exec(id)?.[1] ?? null;
}

/** Whether a row id is a finished turn's "Worked for" row. */
export function isTurnRowId(id: string): boolean {
  return /:turn(:\d+)?$/.test(id);
}

/**
 * The clicks that bring the entries on one pane in line with the settings.
 *
 * `entries` are in page order, the live line last. `working` is whether the pane's thread is
 * working, or `null` until that is known. `owned` are the keys the reader opened or closed
 * themselves: those are never touched.
 *
 * The answer depends only on what is on the page now, so a remount, a thread switch or a reload
 * gives the same result as an uninterrupted run, with no log of past events to keep in step.
 */
export function plan(input: { entries: readonly Entry[]; rules: Rules; working: boolean | null; owned: ReadonlySet<string> }): Change[] {
  const { entries, rules, working, owned } = input;
  if (!rules.autoExpand) return [];
  const last = entries.length - 1;
  const newest = newestTurn(entries);
  const changes: Change[] = [];
  entries.forEach((entry, at) => {
    if (owned.has(entry.key)) return;
    let open = true;
    if (rules.closeOnNew && at !== last) open = false;
    if (rules.closeOnFinish) {
      const finished =
        !entry.live &&
        (entry.folded ||
          working === false ||
          (working === true && entry.turn !== null && newest !== null && entry.turn !== newest));
      if (finished) open = false;
      // Whether the turn is over is not known yet: leave the entry as it is rather than open it for a moment.
      else if (!entry.live && working === null) return;
    }
    if (entry.open !== open) changes.push({ key: entry.key, open });
  });
  return changes;
}

/** The turn of the last row on the pane that names one. */
function newestTurn(entries: readonly Entry[]): string | null {
  for (let at = entries.length - 1; at >= 0; at--) if (entries[at].turn !== null) return entries[at].turn;
  return null;
}

/** The keys the reader has opened or closed, by thread; they outlive BB's own state, which a thread switch drops. */
export type Owned = Map<string, Set<string>>;

export function own(owned: Owned, thread: string, key: string): void {
  let keys = owned.get(thread);
  if (!keys) owned.set(thread, (keys = new Set()));
  keys.add(key);
}

/** How long after the live line leaves the page a row that was not there before may still be its row. */
export const LIVE_CLAIM_MS = 5000;

/** The newest thought the pane has shown, and the rows it sat inside while it was on the page. */
export interface Latest {
  key: string;
  /** Ids of the enclosing rows that have a toggle, outermost first. */
  chain: string[];
}

/** What a pane remembers between looks, for handing the reader's click on the live line to the row it becomes. */
export interface PaneMemory {
  /** The keys on the page at the last look. */
  seen: ReadonlySet<string>;
  /** Every thinking row the pane has shown, so a row is new only once. */
  known: Set<string>;
  /** The newest thought, once there is one. */
  latest: Latest | null;
  /** The reader clicked the live line and its row has not arrived. */
  liveOwned: boolean;
  /** When the live line was first missing after that click. */
  goneAt: number | null;
}

/**
 * The live line has no key, so a click on it is the reader's choice about "the next thinking row". When the
 * line has left the page and a row appears that was not there before, that row is it: returns its key so it
 * can be marked owned. Updates `memory` in place.
 */
export function claimLive(memory: PaneMemory, entries: readonly Entry[], now: number): string | null {
  let claimed: string | null = null;
  if (memory.liveOwned) {
    if (entries.some((entry) => entry.live)) memory.goneAt = null;
    else {
      memory.goneAt ??= now;
      const fresh = entries.filter((entry) => !memory.seen.has(entry.key));
      if (fresh.length > 0) {
        claimed = fresh[fresh.length - 1].key;
        memory.liveOwned = false;
      } else if (now - memory.goneAt > LIVE_CLAIM_MS) memory.liveOwned = false;
    }
  }
  memory.seen = new Set(entries.map((entry) => entry.key));
  return claimed;
}

/** How long a click is given to show in the page before it is taken to have been undone. */
export const SETTLE_MS = 400;
/** How many times in a row one toggle is clicked for the same target when BB keeps undoing it. */
export const MAX_TRIES = 3;

/** What was last done to a toggle: the target it was clicked for, when, and how many times in a row. */
export interface Clicked {
  open: boolean;
  at: number;
  tries: number;
}

/**
 * Whether a toggle that is not as wanted may be clicked now. A toggle is clicked once per target, because the
 * state shows a moment after the click; but BB folds a group again when different work follows it, so a toggle
 * that is still wrong after `SETTLE_MS` is clicked again, up to `MAX_TRIES` times in a row.
 */
export function mayClick(last: Clicked | undefined, want: boolean, now: number): boolean {
  if (!last || last.open !== want) return true;
  return now - last.at > SETTLE_MS && last.tries < MAX_TRIES;
}

/** The record to keep after clicking a toggle for `want`. */
export function clickedNow(last: Clicked | undefined, want: boolean, now: number): Clicked {
  return { open: want, at: now, tries: last && last.open === want ? last.tries + 1 : 1 };
}

/**
 * The newest thinking row the pane has not shown before, or `null`. Rows that appear because the reader
 * unfolded something (`reader`) are old thoughts coming back, not new ones.
 */
export function newestFresh(entries: readonly Entry[], known: ReadonlySet<string>, reader: boolean): Entry | null {
  if (reader) return null;
  for (let at = entries.length - 1; at >= 0; at--) {
    const entry = entries[at];
    if (!entry.live && !known.has(entry.key)) return entry;
  }
  return null;
}

/**
 * The enclosing rows to open so the newest thought is on the page: those of `chain` that are on the page, closed,
 * not the reader's, and only while the thread is working. `present` maps a row id to whether it is open.
 */
export function keepOpen(input: {
  chain: readonly string[];
  present: ReadonlyMap<string, boolean>;
  owned: ReadonlySet<string>;
  working: boolean | null;
}): string[] {
  if (input.working !== true) return [];
  return input.chain.filter((id) => input.present.get(id) === false && !input.owned.has(id));
}

/** Within `slack` pixels of the end of a scrolling box. */
export function atEnd(box: { scrollTop: number; clientHeight: number; scrollHeight: number }, slack = 4): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= slack;
}
