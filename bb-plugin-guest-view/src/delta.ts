// Reading a thread's timeline as deltas. A full read of the nested timeline is large (1.4 MB for a 72-row page
// with 500 tool rows, measured), and a share reads it after every event of a thread someone is watching. The
// server hands out a tag with every page, and a read that names the last tag gets only what changed since
// (a few KB), which is applied to the page held here. Pure: the read itself is passed in, so
// `src/delta.test.ts` runs it without BB.

/** How a delta lists the page's order: a `[start, count]` stretch of the rows already held (bb's own encoding, not `[from, to)`), or the id of a new row. */
export type RowOrder = readonly (string | readonly [number, number])[];

/** One change to a row, at a path of keys and indexes into it: bb 0.50 sends a changed row as these, not whole. */
export type PatchOp = readonly ["append", readonly (string | number)[], string] | readonly ["set", readonly (string | number)[], unknown] | readonly ["delete", readonly (string | number)[]];
export interface RowPatch {
  id: string;
  ops: readonly PatchOp[];
}

const INVALID = Symbol("a patch that does not fit the row");
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The value `op` leaves where it lands; `at` is what is there now. */
function leaf(at: unknown, op: PatchOp): unknown {
  if (op[0] === "set") return op[2];
  if (op[0] === "append") return typeof at === "string" && typeof op[2] === "string" ? at + op[2] : INVALID;
  return INVALID;
}

/** `node` with `op` applied at `op[1][depth..]`; never changes `node` (each object or array on the way is copied). */
function patchAt(node: unknown, op: PatchOp, depth: number): unknown {
  const path = op[1];
  const key = path[depth]!;
  const last = depth === path.length - 1;
  if (Array.isArray(node)) {
    // An index up to the length: a new element goes at the end. bb sends no delete of an element.
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key > node.length) return INVALID;
    if (last && op[0] === "delete") return INVALID;
    const next = last ? leaf(node[key], op) : patchAt(node[key], op, depth + 1);
    if (next === INVALID) return INVALID;
    const copy = [...node];
    copy[key] = next;
    return copy;
  }
  if (!isObject(node) || typeof key !== "string") return INVALID;
  const copy = { ...node };
  if (last && op[0] === "delete") {
    if (!Object.hasOwn(node, key)) return INVALID;
    delete copy[key];
    return copy;
  }
  // Only `set` may make a key; every other step needs it to be there (and it must be the row's own, not the prototype's).
  if (!(last && op[0] === "set") && !Object.hasOwn(node, key)) return INVALID;
  const next = last ? leaf(node[key], op) : patchAt(node[key], op, depth + 1);
  if (next === INVALID) return INVALID;
  Object.defineProperty(copy, key, { configurable: true, enumerable: true, value: next, writable: true });
  return copy;
}

/**
 * `row` with `ops` applied, as a copy (the held row is never changed), or null when they do not fit it: a path that
 * does not resolve, an `append` to something that is not a string, a `delete` of something not there or of an array
 * element, an op of another shape, or a result that is no longer the same row (`id` and `kind` kept). It follows what
 * bb's own page does with `patchRows`; the caller reads a full page when this is null.
 */
export function patchRow<T extends { id: string; kind?: unknown }>(row: T, ops: readonly PatchOp[]): T | null {
  let next: unknown = row;
  for (const op of ops) {
    if (!Array.isArray(op) || !["append", "set", "delete"].includes(op[0]) || !Array.isArray(op[1]) || op[1].length === 0) return null;
    next = patchAt(next, op, 0);
    if (next === INVALID) return null;
  }
  return isObject(next) && next.id === row.id && next.kind === row.kind ? (next as unknown as T) : null;
}

/**
 * The page a delta read stands for: `page` (the rows as the last read left them) with `upsertRows` (new rows) put in
 * their places and `patchRows` applied to the rows held. Without `rowOrder` the order is unchanged; with it, the page
 * is rebuilt from the `[start, count]` stretches and the new ids listed. Returns null when the delta does not fit
 * what is held (a stretch out of range, an id that is not an upsert, a patch for a row not held or that does not
 * apply, an upsert or patch that was not placed exactly once), and the caller reads a full page instead.
 */
export function applyDelta<T extends { id: string; kind?: unknown }>(page: readonly T[], delta: { upsertRows: readonly T[]; patchRows?: readonly RowPatch[]; rowOrder?: RowOrder }): T[] | null {
  const upserts = new Map(delta.upsertRows.map((row) => [row.id, row]));
  const patches = new Map((delta.patchRows ?? []).map((patch) => [patch.id, patch.ops]));
  let upserted = 0;
  let patched = 0;
  let broken = false;
  // A held row as the delta leaves it.
  const place = (row: T): T => {
    const whole = upserts.get(row.id);
    if (whole) {
      upserted += 1;
      return whole;
    }
    const ops = patches.get(row.id);
    if (!ops) return row;
    patched += 1;
    const next = patchRow(row, ops);
    if (!next) {
      broken = true;
      return row;
    }
    return next;
  };
  const fits = () => !broken && upserted === upserts.size && patched === patches.size;
  if (!delta.rowOrder) {
    const out = page.map(place);
    return fits() ? out : null;
  }
  const out: T[] = [];
  for (const entry of delta.rowOrder) {
    if (typeof entry === "string") {
      const row = upserts.get(entry);
      if (!row) return null;
      upserted += 1;
      out.push(row);
      continue;
    }
    const [start, count] = entry;
    if (!(Number.isInteger(start) && Number.isInteger(count) && start >= 0 && count > 0 && start + count <= page.length)) return null;
    for (let i = start; i < start + count; i++) out.push(place(page[i]!));
  }
  return fits() ? out : null;
}

/** What a timeline read answers: a whole page, or (when it was asked for what changed since a tag) a delta. */
export type TimelineRead<T extends { id: string; kind?: unknown }> =
  | { rows: readonly T[]; tag?: string; timelinePage?: { olderCursor?: unknown } | null }
  | { delta: { afterTag?: string; upsertRows: readonly T[]; patchRows?: readonly RowPatch[]; rowOrder?: RowOrder; fields?: { timelinePage?: { olderCursor?: unknown } | null } }; tag?: string };

/** The newest page as the last read left it. */
export interface Held<T extends { id: string; kind?: unknown }> {
  rows: T[];
  /** The tag of the last read; null until one carried a tag (then every read is a full one). */
  tag: string | null;
  /** When a whole page was last read. */
  fullAt: number;
  /** Whether the thread has rows older than the page. */
  older: boolean;
}

export const emptyHeld = <T extends { id: string; kind?: unknown }>(): Held<T> => ({ rows: [], tag: null, fullAt: 0, older: false });

/** A whole page is read at least this often, so a rewrite the deltas do not show (a compaction) cannot last long. */
export const FULL_EVERY_MS = 60_000;

/**
 * Brings `held` up to date: a delta against its tag when there is one and it is young enough, else a whole
 * page; a delta that does not fit is followed by a whole page at once. Leaves `held` as it was when a read
 * throws. Says whether the update was a delta.
 */
export async function readHeld<T extends { id: string; kind?: unknown }>(held: Held<T>, read: (afterTag?: string) => Promise<TimelineRead<T>>, now: () => number = Date.now): Promise<{ delta: boolean }> {
  const began = now();
  if (held.tag !== null && began - held.fullAt < FULL_EVERY_MS) {
    const page = await read(held.tag);
    if ("delta" in page) {
      // A delta against another tag than the one held is not for this page.
      const rows = page.delta.afterTag === undefined || page.delta.afterTag === held.tag ? applyDelta(held.rows, page.delta) : null;
      if (rows) {
        held.rows = rows;
        held.tag = page.tag ?? null;
        // `fields.timelinePage` holds only what changed: the cursor moved when it is named (null: there is no older page now).
        const cursor = page.delta.fields?.timelinePage;
        if (cursor && "olderCursor" in cursor) held.older = Boolean(cursor.olderCursor);
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

function take<T extends { id: string; kind?: unknown }>(held: Held<T>, page: Extract<TimelineRead<T>, { rows: readonly T[] }>, at: number) {
  held.rows = [...page.rows];
  held.tag = page.tag ?? null;
  held.fullAt = at;
  held.older = Boolean(page.timelinePage?.olderCursor);
}
