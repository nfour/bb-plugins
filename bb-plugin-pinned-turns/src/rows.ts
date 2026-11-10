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

export function indexOf(rows: readonly Row[], hasOlder: boolean): TimelineIndex {
  const rank = new Map<string, number>();
  const messages: Message[] = [];
  // A turn runs from one user row to the next; its status is read off the events inside.
  let events: SpanEvent[] = [];
  let replies: Message[] = [];
  let asked: Message | null = null;
  const close = () => {
    const status = turnStatus(events);
    if (status) for (const reply of replies) reply.status = status;
    // The question only shows that its turn is still in progress; how it ended is the reply's to say.
    if (status === "pending" && asked) asked.status = status;
    events = [];
    replies = [];
    asked = null;
  };
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
    // Bounded first: a long message is read in full only to be cut to a line.
    const full = oneLine(textOf(row).slice(0, TEXT_READ), 800);
    if (full === "") return;
    const message: Message = {
      id: row.id,
      role: row.role,
      rank: i,
      title: full.slice(0, 240),
      full,
      by: row.role === "user" && row.initiator === "system" ? "system" : "user",
    };
    if (row.role === "user") asked = message;
    else replies.push(message);
    messages.push(message);
  });
  close();
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
