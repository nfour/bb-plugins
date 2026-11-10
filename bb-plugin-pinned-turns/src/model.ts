// The two rules that decide what the bar says and where a jump lands. Nothing
// here touches the DOM, so both are decided from plain numbers and can be
// checked without a browser.

/** The bar's reserved height, in px: the room a jumped-to row is landed below. */
export const PIN_ROW_HEIGHT = 48;

/**
 * An entry the bar can name: a user message or an agent reply, with the top of
 * its row in the same coordinate space as the pin line.
 */
export interface Pin<T> {
  top: number;
  title: string;
  /** What a press jumps to; opaque to the model. */
  ref: T;
}

/**
 * What the bar should show: the last user message and the last reply whose top
 * has passed the pin line. Both halves use the same line, because they share one
 * row. A half is null only when nothing above the line qualifies.
 *
 * @param openers - User messages in document order.
 * @param replies - Agent replies in document order.
 * @param pinTop - The pin line.
 */
export function bandContent<T>(
  openers: readonly Pin<T>[],
  replies: readonly Pin<T>[],
  pinTop: number,
): { message: Pin<T> | null; reply: Pin<T> | null } {
  let message: Pin<T> | null = null;
  // `<=` so a message that has just arrived is in hand rather than a frame late,
  // and the *last* one wins, which makes the bar follow the reader down.
  for (const one of openers) if (one.top <= pinTop) message = one;
  let reply: Pin<T> | null = null;
  for (const one of replies) if (one.top <= pinTop) reply = one;
  return { message, reply };
}

/**
 * Where a jump must leave the row it was asked for: below the bar, with the
 * bar's own height as room, so the row arrives legible instead of half-covered
 * by the thing naming it. Returns the row's top as an offset from the pin line;
 * scroll by this much.
 *
 * @param rowTop - The row's top, in the same coordinate space as `pinTop`.
 * @param pinTop - The scroller's own top edge.
 * @param height - Room the bar needs, in px.
 */
export function jumpOffset(rowTop: number, pinTop: number, height = PIN_ROW_HEIGHT): number {
  return rowTop - pinTop - (height > 0 ? height : 0);
}

// ---------------------------------------------------------------------------
// The fast path. `bandContent` above reads every row's top on every paint; BB's
// timeline is windowed and its rows are in chronological order, so none of that
// is needed. Row tops only have to be searched to find *one* boundary row, and
// everything above the boundary is answered from the timeline data, which also
// covers messages whose rows are not mounted. `bandContent` stays as the oracle
// the checks compare this against.

/** How a turn ended up, when that is worth a mark. A turn that completed has none. */
export type TurnStatus = "pending" | "error" | "interrupted";

/** One user message or agent reply, in timeline order. */
export interface Message {
  id: string;
  role: "user" | "assistant";
  /** Timeline position of its row among *all* rows, for comparing with a DOM row. */
  rank: number;
  /** One line, cut to fit a bar. */
  title: string;
  /** The whole text with whitespace collapsed, for a tooltip. */
  full: string;
  /** Whether the user typed a `user` row, or BB wrote it (a child thread finishing). */
  by: "user" | "system";
  /** A reply's turn status, or "pending" on the user message whose turn is in progress; absent otherwise. */
  status?: TurnStatus;
}

/** What a row contributes to its turn, in the terms `turnStatus` needs. */
export type SpanEvent = "assistant" | "error" | "interrupted" | "pending";

/**
 * How a turn ended, from the events between one user message and the next.
 * Running work wins. Otherwise the last of reply, failure and interruption decides:
 * a provider error that a later reply recovered from is not a failed turn.
 */
export function turnStatus(events: readonly SpanEvent[]): TurnStatus | undefined {
  if (events.includes("pending")) return "pending";
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event === "error" || event === "interrupted") return event;
    if (event === "assistant") return undefined;
  }
  return undefined;
}

/** The last index in 0..n-1 whose top is at or above `line`, or -1. Tops must not decrease. */
export function lastAtOrAbove(n: number, topAt: (i: number) => number, line: number): number {
  let lo = 0;
  let hi = n - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (topAt(mid) <= line) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/**
 * The message and reply for a boundary: every message ranked at or before
 * `boundaryRank` is above the pin line, so the answer is the last user message
 * and the last reply among them. Same result as `bandContent` over all rows.
 */
export function bandAt(
  messages: readonly Message[],
  boundaryRank: number,
): { message: Message | null; reply: Message | null } {
  let message: Message | null = null;
  let reply: Message | null = null;
  // Newest first, so this stops as soon as both halves are found.
  let i = lastAtOrAbove(messages.length, (k) => messages[k]!.rank, boundaryRank);
  for (; i >= 0 && (message === null || reply === null); i--) {
    const one = messages[i]!;
    if (one.role === "user") message ??= one;
    else reply ??= one;
  }
  return { message, reply };
}

/** One line for a bar half: whitespace collapsed, fences and heading marks dropped. */
export function oneLine(text: string, max = 240): string {
  return text
    .replace(/```[^\n]*\n?/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** A timeline row id's rank key: the data id a mounted row stands for, or null. */
export function dataIdOf(domRowId: string): string {
  // BB folds runs of work rows into `<thread>:<turn>:work-summary:<data id of a member>`.
  const at = domRowId.indexOf(":work-summary:");
  return at < 0 ? domRowId : domRowId.slice(at + ":work-summary:".length);
}
