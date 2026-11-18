import type { useSdk } from "@get-bb/plugin-sdk/app";
import { workIcon } from "./icons.ts";
import { replyHeight, userSize, type Item } from "./model.ts";

// `timeline` is overloaded; a read without `afterTag` is a full page, never a delta.
type Page = Extract<Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["timeline"]>>, { rows: readonly unknown[] }>;
export type Row = Page["rows"][number];

/** The rows of a page in order, with a turn's children flattened in after it. */
export function flatten(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row);
    if (row.kind === "turn" && row.children) flatten(row.children, out);
  }
  return out;
}

/** How a delta lists the page's order: a `[start, count]` stretch of the rows already held (`count` rows from index `start`), or the id of one row. */
export type RowOrder = readonly (string | readonly [number, number])[];

/** One step of a row patch (bb 0.50): `path` is a non-empty list of keys and array indexes into the row's JSON. */
export type PatchOp = readonly ["append", Path, string] | readonly ["set", Path, unknown] | readonly ["delete", Path];
type Path = readonly (string | number)[];
export interface RowPatch {
  id: string;
  ops: readonly PatchOp[];
}

type Json = Record<string, unknown> | unknown[];

const isContainer = (value: unknown): value is Json => typeof value === "object" && value !== null;
/** Keys that would reach the prototype chain are never followed. */
const SAFE_KEY = (key: string | number): boolean => key !== "__proto__" && key !== "constructor" && key !== "prototype";

/**
 * `row` with the ops of one patch applied, as a new row: the objects and arrays along each path are copied and every
 * other part is shared, so the held row is never changed. The ops mean what bb's `diffJsonValue` makes of them: `append`
 * adds text to the string at the path, `set` puts a value there (objects along the way are created; an array takes an
 * index up to its length), `delete` removes an object's key. Returns null when an op does not fit the row (a path that
 * does not resolve, an `append` to something that is not a string, a `delete` of an array element, which bb never sends),
 * and the caller reads a full page.
 */
export function patchRow<T extends object>(row: T, ops: readonly PatchOp[]): T | null {
  const root: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  /** The nodes already copied by this patch, so a second op on the same one does not copy it again. */
  const copied = new WeakSet<object>([root]);
  const own = (node: Json): Json => {
    if (copied.has(node)) return node;
    const copy = Array.isArray(node) ? [...node] : { ...node };
    copied.add(copy);
    return copy;
  };
  for (const op of ops) {
    const [kind, path] = op;
    if (!Array.isArray(path) || path.length === 0 || !path.every(SAFE_KEY)) return null;
    // Walk to the node that holds the last step, copying each node on the way and re-linking it to its parent.
    let at: Json = root;
    for (let step = 0; step < path.length - 1; step++) {
      const key = path[step]!;
      const child = (at as Record<string | number, unknown>)[key];
      let next: Json;
      if (isContainer(child)) next = own(child);
      else if (child === undefined && kind === "set" && typeof key === "string" && !Array.isArray(at)) next = {};
      else if (child === undefined && kind === "set" && typeof key === "number" && Array.isArray(at) && key === at.length) next = {};
      else return null;
      if (!placeable(at, key)) return null;
      (at as Record<string | number, unknown>)[key] = next;
      at = next;
    }
    const last = path[path.length - 1]!;
    const target = at as Record<string | number, unknown>;
    if (kind === "append") {
      const text = op[2];
      if (typeof text !== "string" || typeof target[last] !== "string") return null;
      target[last] = (target[last] as string) + text;
    } else if (kind === "set") {
      if (!placeable(at, last)) return null;
      target[last] = op[2];
    } else if (kind === "delete") {
      if (Array.isArray(at) || !(typeof last === "string" && Object.hasOwn(at, last))) return null;
      delete target[last];
    } else return null;
  }
  return root as unknown as T;
}

/** Whether `key` can be written in `node`: a string key in an object, an index up to the length in an array. */
function placeable(node: Json, key: string | number): boolean {
  if (Array.isArray(node)) return typeof key === "number" && Number.isInteger(key) && key >= 0 && key <= node.length;
  return typeof key === "string";
}

/**
 * The page a delta read stands for: `page` (the rows as the last read left them) with `upsertRows`
 * put in their places and `patchRows` applied to the rows held. Without `rowOrder` the order is unchanged and every
 * upsert must already be on the page; with it, the page is rebuilt from the stretches and ids listed. Returns null when
 * the delta does not fit what is held (a stretch out of range, an id nowhere, a patch for a row not held or one that
 * does not apply), and the caller reads a full page instead.
 */
export function applyDelta<T extends { id: string }>(
  page: readonly T[],
  delta: { upsertRows: readonly T[]; patchRows?: readonly RowPatch[]; rowOrder?: RowOrder },
): T[] | null {
  const upserts = new Map(delta.upsertRows.map((row) => [row.id, row]));
  for (const patch of delta.patchRows ?? []) {
    const held = page.find((row) => row.id === patch.id);
    const next = held ? patchRow(held, patch.ops) : null;
    if (!next) return null;
    upserts.set(patch.id, next);
  }
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
    const [start, count] = entry;
    if (!(Number.isInteger(start) && Number.isInteger(count) && start >= 0 && count >= 0 && start + count <= page.length)) return null;
    for (let i = start; i < start + count; i++) out.push(upserts.get(page[i]!.id) ?? page[i]!);
  }
  // Every upsert must have a place, or a row would be lost.
  for (const id of upserts.keys()) if (!out.some((row) => row.id === id)) return null;
  return out;
}

/**
 * The held rows brought up to date with a refetch of the newest page. `fresh` is
 * the page's rows; `updates` are rows older than the page that changed. Held rows
 * inside the page's window that are not in it were rewritten and are dropped;
 * everything older is kept.
 */
export function mergeNewest(held: readonly Row[], fresh: readonly Row[], updates: readonly Row[] = []): Row[] {
  const windowStart = fresh[0]?.sourceSeqStart ?? 0;
  const ids = new Set(fresh.map((row) => row.id));
  const changed = new Map(updates.map((row) => [row.id, row]));
  const kept = held.filter((row) => row.sourceSeqStart < windowStart && !ids.has(row.id)).map((row) => changed.get(row.id) ?? row);
  return [...kept, ...fresh];
}

/** An older page placed before the held rows; a row both hold is kept once. */
export function prependOlder(held: readonly Row[], older: readonly Row[]): Row[] {
  const ids = new Set(held.map((row) => row.id));
  return [...older.filter((row) => !ids.has(row.id)), ...held];
}

/** Rows kept as items by id, so a refetch only re-estimates what changed. */
export type Memo = Map<string, { key: string; item: Item }>;

const SUMMARY_HEIGHT = 20;
const WORK_HEIGHT = 26;
const SYSTEM_HEIGHT = 20;
const ERROR_HEIGHT = 44;

/** How long a row's text is read for its size; a longer one is as tall as the page will let it be. */
const TEXT_READ = 20000;

/** The longest preview kept for a row. */
const TIP_CHARS = 90;
/** How much of a message a note of several lines can show. */
const MORE_CHARS = 420;

/** A message's first line that says something, without its Markdown marks, cut for a preview; "" if there is none. */
export function firstLine(text: string): string {
  for (const raw of text.slice(0, 2000).split("\n")) {
    const line = raw.replace(/^[\s>#*+\-`|]+/, "").replace(/[*_`]+/g, "").trim();
    if (line.length > 0) return line.length > TIP_CHARS ? line.slice(0, TIP_CHARS - 1) + "…" : line;
  }
  return "";
}

/** A message's first lines that say something, joined with spaces, cut for a note of several lines; "" if there is none. */
export function moreLines(text: string): string {
  const parts: string[] = [];
  let length = 0;
  for (const raw of text.slice(0, 4000).split("\n")) {
    const line = raw.replace(/^[\s>#*+\-`|]+/, "").replace(/[*_`]+/g, "").trim();
    if (line.length === 0) continue;
    parts.push(line);
    length += line.length + 1;
    if (length > MORE_CHARS) break;
  }
  const joined = parts.join(" ");
  return joined.length > MORE_CHARS ? joined.slice(0, MORE_CHARS - 1) + "…" : joined;
}

/** `more` for a message: its text from the first line on, only when it adds to `tip`. */
function moreOf(text: string, tip: string): { more?: string } {
  const more = moreLines(text);
  return more.length > tip.length ? { more } : {};
}

/** The note's name for a row of work: BB's own label for it ("Ran command") and what it ran, read or touched. */
function workNote(row: Row): { icon: string; label?: string; tip?: string } {
  const presentation = (row as { presentation?: { label?: { pending?: string; completed?: string }; title?: string } | null }).presentation;
  if (!presentation) return { icon: workIcon((row as { workKind?: unknown }).workKind) };
  const live = (row as { status?: string }).status === "pending";
  const label = live ? presentation.label?.pending : presentation.label?.completed;
  const tip = typeof presentation.title === "string" ? firstLine(presentation.title) : "";
  return { icon: workIcon((row as { workKind?: unknown }).workKind), ...(label ? { label } : {}), ...(tip ? { tip } : {}) };
}

/** A system row's own title ("Interrupted", a note's subject) when it has one. */
function systemNote(row: Row): { tip?: string } {
  const title = (row as { title?: unknown }).title;
  const tip = typeof title === "string" ? firstLine(title) : "";
  return tip ? { tip } : {};
}

function estimate(row: Row, finished: ReadonlySet<string>): Item {
  const id = row.id;
  switch (row.kind) {
    case "conversation": {
      if (row.role === "user") {
        const { h, w } = userSize(row.text.slice(0, TEXT_READ));
        const tip = firstLine(row.text);
        return { id, kind: "user", h, w, tip, icon: "user", ...moreOf(row.text, tip) };
      }
      const tip = firstLine(row.text);
      return { id, kind: "reply", h: replyHeight(row.text.slice(0, TEXT_READ)), w: 1, tip, icon: "agent", ...moreOf(row.text, tip) };
    }
    case "turn": {
      const steps = (row as { summaryCount?: number }).summaryCount;
      return { id, kind: "work", h: SUMMARY_HEIGHT, w: 1, label: "Worked", icon: "worked", ...(steps ? { tip: `${steps} ${steps === 1 ? "step" : "steps"}` } : {}) };
    }
    case "work":
      // A finished turn's work is folded into its "Worked for" row; a live one shows each.
      return { id, kind: "work", h: row.turnId !== null && finished.has(row.turnId) ? 0 : WORK_HEIGHT, w: 1, ...workNote(row) };
    case "system":
      if (row.systemKind === "error") return { id, kind: "error", h: ERROR_HEIGHT, w: 1 };
      if (row.systemKind === "operation" && row.operationKind === "reasoning" && row.status === "completed") {
        const thought = firstLine(row.title ?? "");
        return { id, kind: "work", h: row.turnId !== null && finished.has(row.turnId) ? 0 : WORK_HEIGHT, w: 1, label: "Thinking", icon: "think", ...(thought ? { tip: thought } : {}) };
      }
      return { id, kind: "system", h: SYSTEM_HEIGHT, w: 1, ...systemNote(row) };
  }
}

/** The thread's rows as items in order. The index of an item is its rank. */
export function itemsOf(rows: readonly Row[], memo: Memo): Item[] {
  const finished = new Set<string>();
  for (const row of rows) if (row.kind === "turn" && row.status !== "pending") finished.add(row.turnId);
  const seen = new Set<string>();
  const items = rows.map((row) => {
    seen.add(row.id);
    // What an estimate reads: the row's kind, how long its text is, and whether its turn is over.
    const length = row.kind === "conversation" ? row.text.length : 0;
    const key = `${row.kind}|${length}|${row.turnId !== null && finished.has(row.turnId) ? 1 : 0}|${row.kind === "system" ? row.systemKind : ""}|${(row as { status?: string }).status ?? ""}`;
    const held = memo.get(row.id);
    if (held && held.key === key) return held.item;
    const item = estimate(row, finished);
    memo.set(row.id, { key, item });
    return item;
  });
  // Rows rewritten away do not stay behind.
  if (memo.size > seen.size) for (const id of memo.keys()) if (!seen.has(id)) memo.delete(id);
  return items;
}
