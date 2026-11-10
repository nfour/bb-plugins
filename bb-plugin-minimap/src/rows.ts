import type { useSdk } from "@get-bb/plugin-sdk/app";
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

/** How a delta lists the page's order: a `[from, to]` stretch of the rows already held (to exclusive), or the id of one row. */
export type RowOrder = readonly (string | readonly [number, number])[];

/**
 * The page a delta read stands for: `page` (the rows as the last read left them) with `upsertRows`
 * put in their places. Without `rowOrder` the order is unchanged and every upsert must already be on
 * the page; with it, the page is rebuilt from the stretches and ids listed. Returns null when the
 * delta does not fit what is held (a stretch out of range, an id nowhere), and the caller reads a
 * full page instead.
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

/** A message's first line that says something, without its Markdown marks, cut for a preview; "" if there is none. */
export function firstLine(text: string): string {
  for (const raw of text.slice(0, 2000).split("\n")) {
    const line = raw.replace(/^[\s>#*+\-`|]+/, "").replace(/[*_`]+/g, "").trim();
    if (line.length > 0) return line.length > TIP_CHARS ? line.slice(0, TIP_CHARS - 1) + "…" : line;
  }
  return "";
}

function estimate(row: Row, finished: ReadonlySet<string>): Item {
  const id = row.id;
  switch (row.kind) {
    case "conversation": {
      if (row.role === "user") {
        const { h, w } = userSize(row.text.slice(0, TEXT_READ));
        return { id, kind: "user", h, w, tip: firstLine(row.text) };
      }
      return { id, kind: "reply", h: replyHeight(row.text.slice(0, TEXT_READ)), w: 1, tip: firstLine(row.text) };
    }
    case "turn":
      return { id, kind: "work", h: SUMMARY_HEIGHT, w: 1 };
    case "work":
      // A finished turn's work is folded into its "Worked for" row; a live one shows each.
      return { id, kind: "work", h: row.turnId !== null && finished.has(row.turnId) ? 0 : WORK_HEIGHT, w: 1 };
    case "system":
      if (row.systemKind === "error") return { id, kind: "error", h: ERROR_HEIGHT, w: 1 };
      if (row.systemKind === "operation" && row.operationKind === "reasoning" && row.status === "completed") {
        return { id, kind: "work", h: row.turnId !== null && finished.has(row.turnId) ? 0 : WORK_HEIGHT, w: 1 };
      }
      return { id, kind: "system", h: SYSTEM_HEIGHT, w: 1 };
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
    const key = `${row.kind}|${length}|${row.turnId !== null && finished.has(row.turnId) ? 1 : 0}|${row.kind === "system" ? row.systemKind : ""}`;
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
