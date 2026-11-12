// Reading a thread's timeline as deltas. A full read of the nested timeline is large (1.4 MB for a 72-row page
// with 500 tool rows, measured), and a share reads it after every event of a thread someone is watching. The
// server hands out a tag with every page, and a read that names the last tag gets only what changed since
// (a few KB), which is applied to the page held here. Pure: the read itself is passed in, so
// `src/delta.test.ts` runs it without BB.

/** How a delta lists the page's order: a `[from, to)` stretch of the rows already held, or the id of one row. */
export type RowOrder = readonly (string | readonly [number, number])[];

/**
 * The page a delta read stands for: `page` (the rows as the last read left them) with `upsertRows` put in
 * their places. Without `rowOrder` the order is unchanged and every upsert must already be on the page; with
 * it, the page is rebuilt from the stretches and ids listed. Returns null when the delta does not fit what is
 * held (a stretch out of range, an id nowhere), and the caller reads a full page instead.
 */
export function applyDelta<T extends { id: string }>(page: readonly T[], delta: { upsertRows: readonly T[]; rowOrder?: RowOrder }): T[] | null {
  const upserts = new Map(delta.upsertRows.map((row) => [row.id, row]));
  if (!delta.rowOrder) {
    const out = page.map((row) => upserts.get(row.id) ?? row);
    for (const id of upserts.keys()) if (!page.some((row) => row.id === id)) return null;
    return out;
  }
  const held = new Map(page.map((row) => [row.id, row]));
  const out: T[] = [];
  for (const entry of delta.rowOrder) {
    if (typeof entry === "string") {
      const row = upserts.get(entry) ?? held.get(entry);
      if (!row) return null;
      out.push(row);
      continue;
    }
    const [from, to] = entry;
    if (!(from >= 0 && from <= to && to <= page.length)) return null;
    for (let i = from; i < to; i++) out.push(upserts.get(page[i]!.id) ?? page[i]!);
  }
  // Every upsert must have a place, or a row would be lost.
  for (const id of upserts.keys()) if (!out.some((row) => row.id === id)) return null;
  return out;
}

/** What a timeline read answers: a whole page, or (when it was asked for what changed since a tag) a delta. */
export type TimelineRead<T extends { id: string }> =
  | { rows: readonly T[]; tag?: string; timelinePage?: { olderCursor?: unknown } | null }
  | { delta: { upsertRows: readonly T[]; rowOrder?: RowOrder; fields?: { timelinePage?: { olderCursor?: unknown } | null } }; tag?: string };

/** The newest page as the last read left it. */
export interface Held<T extends { id: string }> {
  rows: T[];
  /** The tag of the last read; null until one carried a tag (then every read is a full one). */
  tag: string | null;
  /** When a whole page was last read. */
  fullAt: number;
  /** Whether the thread has rows older than the page. */
  older: boolean;
}

export const emptyHeld = <T extends { id: string }>(): Held<T> => ({ rows: [], tag: null, fullAt: 0, older: false });

/** A whole page is read at least this often, so a rewrite the deltas do not show (a compaction) cannot last long. */
export const FULL_EVERY_MS = 60_000;

/**
 * Brings `held` up to date: a delta against its tag when there is one and it is young enough, else a whole
 * page; a delta that does not fit is followed by a whole page at once. Leaves `held` as it was when a read
 * throws. Says whether the update was a delta.
 */
export async function readHeld<T extends { id: string }>(held: Held<T>, read: (afterTag?: string) => Promise<TimelineRead<T>>, now: () => number = Date.now): Promise<{ delta: boolean }> {
  const began = now();
  if (held.tag !== null && began - held.fullAt < FULL_EVERY_MS) {
    const page = await read(held.tag);
    if ("delta" in page) {
      const rows = applyDelta(held.rows, page.delta);
      if (rows) {
        held.rows = rows;
        held.tag = page.tag ?? null;
        const cursor = page.delta.fields?.timelinePage;
        if (cursor) held.older = Boolean(cursor.olderCursor);
        return { delta: true };
      }
    } else {
      // The server answered a whole page anyway (it could not tell what changed since the tag).
      take(held, page, began);
      return { delta: false };
    }
  }
  const whole = await read();
  if ("delta" in whole) throw new Error("The timeline answered a delta to a read that named no tag.");
  take(held, whole, began);
  return { delta: false };
}

function take<T extends { id: string }>(held: Held<T>, page: Extract<TimelineRead<T>, { rows: readonly T[] }>, at: number) {
  held.rows = [...page.rows];
  held.tag = page.tag ?? null;
  held.fullAt = at;
  held.older = Boolean(page.timelinePage?.olderCursor);
}
