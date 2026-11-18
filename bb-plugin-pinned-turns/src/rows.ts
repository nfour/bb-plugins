import type { useSdk } from "@get-bb/plugin-sdk/app";
import { oneLine, turnStatus, type Message, type SpanEvent } from "./model.ts";

// `timeline` is overloaded; a read without `afterTag` is a full page, never a delta.
type Page = Extract<Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["timeline"]>>, { rows: readonly unknown[] }>;
export type Row = Page["rows"][number];
type OutlineItem = Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["conversationOutline"]>>["items"][number];

/** The thread's rows in order, and what is known about them. Rebuilt, never mutated. */
export interface TimelineIndex {
  /** Every row id → its position, so a DOM row can be placed among the messages. */
  rank: ReadonlyMap<string, number>;
  messages: readonly Message[];
  /** Whether older rows than the ones held exist and are not fetched yet. */
  hasOlder: boolean;
}

/** The rows of a page in order, with a turn's children flattened in after it. */
export function flatten(rows: readonly Row[], out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row);
    if (row.kind === "turn" && row.children) flatten(row.children, out);
  }
  return out;
}

/** How a delta lists the page's order: a `[start, count]` stretch of the rows already held (`count` rows from index `start`), or the id of one new row. */
export type RowOrder = readonly (string | readonly [number, number])[];

/** Where in a row an op acts: string keys and array indexes, never empty. */
type PatchPath = readonly (string | number)[];
/** One change to a row already held, as BB (0.50 and later) sends it in a delta's `patchRows`. */
export type RowOp = readonly ["append", PatchPath, string] | readonly ["set", PatchPath, unknown] | readonly ["delete", PatchPath];
export interface RowPatch {
  id: string;
  ops: readonly RowOp[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const BAD = Symbol("a patch that does not fit");

/** The value an op leaves at its last key: `set` replaces it, `append` extends a string that is there. */
function leaf(held: unknown, op: RowOp): unknown {
  if (op[0] === "set") return op[2];
  return op[0] === "append" && typeof held === "string" ? held + op[2] : BAD;
}

/**
 * `node` with `op` applied at `op[1][depth]` and below: copied along the path, `node` itself never
 * touched. Follows BB's own client: no key is created on the way (`set` makes only its last key, or the
 * array slot just past the end), `append` needs a string, `delete` needs an object key that exists
 * (an array element is replaced as a whole array, never deleted), and anything else is `BAD`.
 */
function patchAt(node: unknown, op: RowOp, depth: number): unknown {
  const path = op[1];
  const key = path[depth]!;
  const last = depth === path.length - 1;
  if (Array.isArray(node)) {
    if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key > node.length) return BAD;
    if (last && op[0] === "delete") return BAD;
    const next = last ? leaf(node[key], op) : patchAt(node[key], op, depth + 1);
    if (next === BAD) return BAD;
    const copy = [...node];
    copy[key] = next;
    return copy;
  }
  if (!isObject(node) || typeof key !== "string") return BAD;
  if (last && op[0] === "delete") {
    if (node[key] === undefined) return BAD;
    const { [key]: _gone, ...rest } = node;
    return rest;
  }
  const next = last ? leaf(node[key], op) : patchAt(node[key], op, depth + 1);
  if (next === BAD) return BAD;
  const copy = { ...node };
  // Not an assignment: a key like `__proto__` must stay a plain key.
  Object.defineProperty(copy, key, { configurable: true, enumerable: true, value: next, writable: true });
  return copy;
}

/** A copy of `row` with `ops` applied in order, or null when one does not fit or the row would change its id or kind. */
export function patchRow<T extends { id: string }>(row: T, ops: readonly RowOp[]): T | null {
  let now: unknown = row;
  for (const op of ops) {
    if (op[1].length === 0) return null;
    now = patchAt(now, op, 0);
    if (now === BAD) return null;
  }
  const kind = (row as { kind?: unknown }).kind;
  return isObject(now) && now.id === row.id && now.kind === kind ? (now as T) : null;
}

/**
 * The page a delta read stands for: `page` (the rows as the last read left them) with the delta's
 * changes put in their places. `upsertRows` are new or whole replacement rows; `patchRows` are changes to rows
 * held (BB 0.50 sends a changed row as ops, not whole). Without `rowOrder` the order is unchanged and every
 * upsert and patch must be for a row already on the page; with it, the page is rebuilt from the stretches
 * (`[start, count]`) and ids listed. Returns null when the delta does not fit what is held (a stretch out of range, an id
 * nowhere, a patch that does not apply, an upserted or patched row that is not placed exactly once), and the
 * caller reads a full page instead. Overlapping stretches may repeat an untouched held row (bb's own client
 * accepts that too). The held rows are never changed.
 */
export function applyDelta<T extends { id: string }>(
  page: readonly T[],
  delta: { upsertRows: readonly T[]; patchRows?: readonly RowPatch[]; rowOrder?: RowOrder },
): T[] | null {
  const upserts = new Map(delta.upsertRows.map((row) => [row.id, row]));
  const patches = new Map((delta.patchRows ?? []).map((patch) => [patch.id, patch.ops]));
  if (upserts.size !== delta.upsertRows.length || patches.size !== (delta.patchRows ?? []).length) return null;
  let upserted = 0;
  let patched = 0;
  let broken = false;
  // A held row as the delta leaves it.
  const place = (row: T): T => {
    const whole = upserts.get(row.id);
    if (whole) {
      upserted++;
      return whole;
    }
    const ops = patches.get(row.id);
    if (!ops) return row;
    patched++;
    const next = patchRow(row, ops);
    if (!next) broken = true;
    return next ?? row;
  };
  const out: T[] = [];
  if (!delta.rowOrder) {
    for (const row of page) out.push(place(row));
  } else {
    for (const entry of delta.rowOrder) {
      if (typeof entry === "string") {
        // A row named by id is a new one; a held row comes in a stretch.
        const row = upserts.get(entry);
        if (!row) return null;
        upserted++;
        out.push(row);
        continue;
      }
      const [start, count] = entry;
      if (!(Number.isInteger(start) && Number.isInteger(count) && start >= 0 && count >= 0 && start + count <= page.length)) return null;
      for (let i = start; i < start + count; i++) out.push(place(page[i]!));
    }
  }
  // Every upsert and patch must have found its row exactly once, or a change would be lost.
  return !broken && upserted === upserts.size && patched === patches.size ? out : null;
}

/**
 * The held rows brought up to date with a refetch of the newest page. `fresh` is
 * the page's rows; `updates` are rows older than the page that changed (a work row
 * that finished after it scrolled out of the window). Held rows that fall inside
 * the page's window but are not in it were rewritten (an edited message reruns) and
 * are dropped; everything older is kept.
 */
export function mergeNewest(held: readonly Row[], fresh: readonly Row[], updates: readonly Row[] = []): Row[] {
  const windowStart = fresh[0]?.sourceSeqStart ?? 0;
  const ids = new Set(fresh.map((row) => row.id));
  const changed = new Map(updates.map((row) => [row.id, row]));
  const kept = held.filter((row) => row.sourceSeqStart < windowStart && !ids.has(row.id)).map((row) => changed.get(row.id) ?? row);
  return [...kept, ...fresh];
}

/** An older page placed before the held rows; a row both hold (a page that overlaps) is kept once. */
export function prependOlder(held: readonly Row[], older: readonly Row[]): Row[] {
  const ids = new Set(held.map((row) => row.id));
  return [...older.filter((row) => !ids.has(row.id)), ...held];
}

/** How much of a message's text is read to make its title; a collapsed 800 characters fits well inside. */
const TEXT_READ = 3000;

/** What a user row says when it has no text: its attachments, by name. */
function attachmentTitle(row: Extract<Row, { kind: "conversation"; role: "user" }>): string {
  const a = row.attachments;
  if (!a) return "";
  const names = a.localFileDetails.map((file) => file.name);
  const images = a.localImages + a.webImages + a.imageUrls.length;
  if (names.length > 0) return names.join(", ");
  return images > 0 ? (images === 1 ? "Image" : `${images} images`) : "";
}

/** A row's text as the timeline draws it: mentions as their labels, BB's own tag dropped. */
function textOf(row: Extract<Row, { kind: "conversation" }>): string {
  let text = row.text;
  if (row.role === "user") {
    // `@thread:thr_x` is drawn as the thread's title; later ranges first keeps offsets valid.
    for (const { start, end, resource } of [...row.mentions].sort((a, b) => b.start - a.start)) {
      text = text.slice(0, start) + resource.label + text.slice(end);
    }
  }
  text = text.replace(/^\[bb system\]\s*/, "");
  return text.trim() === "" && row.role === "user" ? attachmentTitle(row) : text;
}

/** What a non-message row says about how its turn went. */
function eventOf(row: Row): SpanEvent | null {
  if (row.kind === "conversation") return row.role === "assistant" ? "assistant" : null;
  if (row.status === "pending") return "pending";
  if (row.kind !== "system") return null;
  if (row.systemKind === "error") return "error";
  return row.systemKind === "operation" && row.operationKind === "thread-interrupted" ? "interrupted" : null;
}

/** What a message's title is made from; the same inputs give the same title. */
interface TitleKey {
  role: string;
  text: string;
  mentions: string;
  attachments: string;
  initiator: string;
}

/** A conversation row's title inputs, without reading the text any further than comparing it. */
function titleKey(row: Extract<Row, { kind: "conversation" }>): TitleKey {
  const user = row.role === "user";
  return {
    role: row.role,
    text: row.text,
    mentions: user ? row.mentions.map((m) => `${m.start}-${m.end}:${m.resource.label}`).join("|") : "",
    attachments: user && row.attachments ? `${row.attachments.localFileDetails.map((f) => f.name).join(",")}#${row.attachments.localImages + row.attachments.webImages + row.attachments.imageUrls.length}` : "",
    initiator: user ? row.initiator : "",
  };
}
const sameKey = (a: TitleKey, b: TitleKey) =>
  a.text === b.text && a.role === b.role && a.mentions === b.mentions && a.attachments === b.attachments && a.initiator === b.initiator;

/**
 * Messages kept by row id between reads. A delta changes a row or two, so the text of the rest
 * is not read again: an entry holds what its title was made from and the title (`full`, or "" for
 * a row the bar does not name), and the message itself, handed out again while nothing about it moved.
 */
export type Titles = Map<string, { key: TitleKey; full: string; message?: Message }>;

const sameMessage = (a: Message, b: Message) =>
  a.rank === b.rank && a.title === b.title && a.full === b.full && a.by === b.by && a.status === b.status && a.role === b.role;

export function indexOf(rows: readonly Row[], hasOlder: boolean, titles: Titles = new Map()): TimelineIndex {
  const rank = new Map<string, number>();
  const drafts: Message[] = [];
  // A turn runs from one user row to the next; its status is read off the events inside.
  let events: SpanEvent[] = [];
  let replies: Message[] = [];
  let asked: Message | null = null;
  const close = () => {
    const status = turnStatus(events);
    if (status) for (const reply of replies) reply.status = status;
    // The question only shows that its turn is still running; how it ended is the reply's to say.
    if (status === "pending" && asked) asked.status = status;
    events = [];
    replies = [];
    asked = null;
  };
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    rank.set(row.id, i);
    if (row.kind !== "conversation") {
      const event = eventOf(row);
      if (event) events.push(event);
      return;
    }
    if (row.role === "user") close();
    else events.push("assistant");
    // Another agent's message is not the user's turn to name.
    if (row.role === "user" && row.initiator === "agent") return;
    seen.add(row.id);
    const key = titleKey(row);
    let held = titles.get(row.id);
    if (!held || !sameKey(held.key, key)) {
      // Bounded first: a long message is read in full only to be cut to a line.
      held = { key, full: oneLine(textOf(row).slice(0, TEXT_READ), 800) };
      titles.set(row.id, held);
    }
    if (held.full === "") return;
    const message: Message = {
      id: row.id,
      role: row.role,
      rank: i,
      title: held.full.slice(0, 240),
      full: held.full,
      by: row.role === "user" && row.initiator === "system" ? "system" : "user",
    };
    if (row.role === "user") asked = message;
    else replies.push(message);
    drafts.push(message);
  });
  close();
  // Rows rewritten away do not stay behind.
  if (titles.size > seen.size) for (const id of titles.keys()) if (!seen.has(id)) titles.delete(id);
  // A message whose fields all match the one handed out last time is that one, so what compares by identity stays equal.
  const messages = drafts.map((draft) => {
    const held = titles.get(draft.id)!;
    if (held.message && sameMessage(held.message, draft)) return held.message;
    held.message = draft;
    return draft;
  });
  return { rank, messages, hasOlder };
}

/** Where each user message stands in the thread ("7" of "7/23"), by row id. */
export interface Outline {
  ordinals: ReadonlyMap<string, number>;
  total: number;
}

/**
 * How a message another agent sent (`bb thread tell`) begins. BB's `conversationOutline` has no
 * `initiator`, so this is how its items are told apart; BB itself marks such a
 * user row `initiator: "agent"` by the same pattern.
 */
const AGENT_ENVELOPE = /^\[bb message from thread:[^;\]\s]+(?:;[^\]]*)?\]/;

/** The turn counter from BB's `conversationOutline`, counting the messages the bar names: not another agent's, not an empty one. */
export function outlineOf(items: readonly Pick<OutlineItem, "id" | "preview" | "attachmentSummary">[]): Outline {
  const counted = items.filter((item) => !AGENT_ENVELOPE.test(item.preview) && (item.preview !== "" || item.attachmentSummary));
  return { ordinals: new Map(counted.map((item, i) => [item.id, i + 1])), total: counted.length };
}
