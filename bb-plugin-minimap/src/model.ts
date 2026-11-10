// The pure core of the Minimap: what a row is (its kind, its estimated size) and
// how a thread's rows become the rectangles the strip draws. No DOM here; the
// strip (src/strip.ts) reads the page and hands in numbers.

/** What a rectangle stands for. Each kind has its own colour. */
export type Kind = "user" | "reply" | "work" | "error" | "system";
export const KINDS: readonly Kind[] = ["user", "reply", "work", "error", "system"];

/** A timeline row as the strip knows it before it has ever been on screen. */
export interface Item {
  id: string;
  kind: Kind;
  /** Estimated height in px of the row as the timeline draws it; 0 for a row BB folds away. */
  h: number;
  /** Width as a share of the message column; only a user message is narrower than the column. */
  w: number;
  /** The first line of a message's text, for the preview under the pointer; a row without text has none. */
  tip?: string;
}

/** A row that is on screen now: its real place and size. */
export interface Mounted {
  id: string;
  kind: Kind;
  /** The row's rank among the items, or null when the data has no row for it. */
  rank: number | null;
  y: number;
  h: number;
  w: number;
}

/** What was measured for a row the last time it was on screen. */
export interface Measure {
  h: number;
  w: number;
}

/**
 * The rectangles, top to bottom, in the strip's own pixels (`own`): every row at its
 * measured height, or an estimate until it has been on screen. BB's scroller has its own
 * pixels (`bb`), which shift whenever BB replaces a spacer's estimate with measurements;
 * `bbs` and `owns` are matching points in both, so a scroll position and a spot on the
 * strip convert to one another. `total` is the thread's height in own pixels.
 */
export interface Layout {
  ids: string[];
  kinds: Kind[];
  y: number[];
  h: number[];
  w: number[];
  total: number;
  bbs: number[];
  owns: number[];
}

export const EMPTY_LAYOUT: Layout = { ids: [], kinds: [], y: [], h: [], w: [], total: 0, bbs: [0], owns: [0] };

/** The message column's width and how much of it a bubble may take, as BB draws them. */
const COLUMN = 728;
const BUBBLE_MAX = 0.7;
/** Characters on a line of a reply and of a bubble (text-sm, ~7px a glyph). */
const REPLY_CHARS = 100;
const BUBBLE_CHARS = 68;
const LINE = 23;

/** The number of wrapped lines a text takes at `chars` to a line; a blank line is a half-line gap. */
export function wrappedLines(text: string, chars: number): number {
  let lines = 0;
  let fenced = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (line.trim() === "") lines += 0.5;
    // Code is not wrapped; it scrolls sideways.
    else lines += fenced ? 0.9 : Math.max(1, Math.ceil(line.length / chars));
  }
  return lines;
}

/** A reply's estimated height: its lines, plus the gap BB leaves around the text. */
export function replyHeight(text: string): number {
  return 16 + wrappedLines(text, REPLY_CHARS) * LINE;
}

/** BB cuts a long message of yours short (a 3,900-character one was 379px tall), so it is never estimated taller. */
const USER_MAX_H = 380;

/** A user message's estimated height and width share, from its text. */
export function userSize(text: string): { h: number; w: number } {
  let longest = 0;
  for (const line of text.split("\n")) longest = Math.max(longest, line.length);
  const px = Math.min(longest, BUBBLE_CHARS) * 7 + 32;
  return { h: Math.min(USER_MAX_H, 44 + wrappedLines(text, BUBBLE_CHARS) * LINE), w: Math.min(BUBBLE_MAX, px / COLUMN) };
}

/**
 * The kind of a row BB drew that the data has no row for (a row BB made up), from
 * its DOM id. The data's own kind is preferred where there is one.
 */
export function kindOfDomId(domId: string): Kind {
  if (domId.includes(":work-summary:") || /:turn:\d+$/.test(domId)) return "work";
  if (domId.includes(":user")) return "user";
  if (domId.includes(":assistant:")) return "reply";
  if (/:(error|failed)/.test(domId)) return "error";
  return "system";
}

/** A DOM row id's data id: BB folds a run of work rows into `<thread>:<turn>:work-summary:<data id of a member>`. */
export function dataIdOf(domId: string): string {
  const at = domId.indexOf(":work-summary:");
  return at < 0 ? domId : domId.slice(at + ":work-summary:".length);
}

/**
 * Heights for the data rows a live turn's folded lines stand for. While a turn works BB
 * shows its tool calls as lines ("Explored 3 files", "Ran 4 commands") that each cover
 * several data rows, so the first row of a line is as tall as the line and the others
 * take no room. A line covers rows up to the next row on screen, or to the end of its
 * run of work; a run whose end is not in sight is left to the estimate.
 */
export function foldedHeights(items: readonly Item[], mounted: readonly Mounted[]): Map<string, Measure> {
  const out = new Map<string, Measure>();
  const ranks = mounted.flatMap((row) => (row.rank === null ? [] : [row.rank])).sort((a, b) => a - b);
  for (const row of mounted) {
    if (row.rank === null || !row.id.includes(":work-summary:")) continue;
    const first = row.rank;
    // The end of this line's run: the first row that is not work, or a turn's own row.
    let end = first + 1;
    while (end < items.length && items[end]!.kind === "work" && !TURN_ROW.test(items[end]!.id)) end++;
    const next = ranks.find((rank) => rank > first);
    const known = (next !== undefined && next <= end) || end === items.length;
    if (known) end = Math.min(end, next ?? end);
    else end = first + 1;
    out.set(items[first]!.id, { h: row.h, w: 1 });
    for (let rank = first + 1; rank < end; rank++) out.set(items[rank]!.id, { h: 0, w: 1 });
  }
  return out;
}
const TURN_ROW = /:turn:\d+$/;

/** Strip pixels per content pixel: the whole thread always spans the strip's full height, however short. */
export function scaleFor(total: number, stripHeight: number): number {
  if (total <= 0 || stripHeight <= 0) return 0.1;
  return stripHeight / total;
}

function push(out: Layout, id: string, kind: Kind, y: number, h: number, w: number) {
  out.ids.push(id);
  out.kinds.push(kind);
  out.y.push(y);
  out.h.push(h);
  out.w.push(w);
}

/** Calibration of the estimates by kind: how much taller or shorter rows turned out than guessed. */
function calibrate(items: readonly Item[], measured: (rank: number) => number | undefined): Record<Kind, number> {
  const seen = { user: 0, reply: 0, work: 0, error: 0, system: 0 };
  const real = { ...seen };
  const guess = { ...seen };
  items.forEach((item, rank) => {
    const h = measured(rank);
    if (h === undefined || item.h <= 0) return;
    seen[item.kind]++;
    real[item.kind] += h;
    guess[item.kind] += item.h;
  });
  const out = { user: 1, reply: 1, work: 1, error: 1, system: 1 };
  for (const kind of KINDS) if (seen[kind] >= 3) out[kind] = Math.min(3, Math.max(0.4, real[kind] / guess[kind]));
  return out;
}

/**
 * The thread as rectangles. Every row is laid at its measured height where it has been
 * on screen and at its estimate (scaled by how the estimates did for its kind) where it has
 * not, so the map does not move when BB re-measures its spacers while the reader scrolls.
 * Rows on screen also tie the strip's pixels to the scroller's (`bbs`/`owns`).
 * `total` is the scroller's content height.
 */
export function buildLayout(args: {
  items: readonly Item[];
  mounted: readonly Mounted[];
  cache: ReadonlyMap<string, Measure>;
  total: number;
  /** Scroller pixels of older history above the first item that the strip has no rows for (a page not read); drawn as a blank. */
  lead?: number;
}): Layout {
  const { items, mounted, cache, total, lead = 0 } = args;
  const out: Layout = { ids: [], kinds: [], y: [], h: [], w: [], total, bbs: [0, Math.max(1, total)], owns: [0, Math.max(1, total)] };
  if (mounted.length === 0) return out;
  // The rows on screen that the data has a row for, by rank; a folded row stands for several and is not one of them.
  const exact = new Map<number, Mounted>();
  for (const row of mounted) if (row.rank !== null && !row.id.includes(":work-summary:")) exact.set(row.rank, row);
  if (items.length === 0 || exact.size === 0) {
    // Nothing on screen is known to the data yet: only what is on screen can be drawn.
    for (const row of mounted) push(out, row.id, row.kind, row.y, row.h, row.w);
    return out;
  }
  // A row the data now folds away (a finished turn's tool call) stays gone even if it was measured while the turn worked.
  const measured = (rank: number) => exact.get(rank)?.h ?? (items[rank]!.h <= 0 ? 0 : cache.get(items[rank]!.id)?.h);
  const ratio = calibrate(items, measured);
  const hs = items.map((item, rank) => measured(rank) ?? item.h * ratio[item.kind]);
  const top: number[] = new Array(items.length);
  let own = Math.max(0, lead);
  for (let rank = 0; rank < items.length; rank++) {
    top[rank] = own;
    own += hs[rank]!;
  }
  out.total = own;
  items.forEach((item, rank) => {
    const h = hs[rank]!;
    if (h > 0) push(out, item.id, item.kind, top[rank]!, h, exact.get(rank)?.w ?? cache.get(item.id)?.w ?? item.w);
  });
  // The points that tie the two kinds of pixel together, in order, each strictly further down the scroller.
  const bbs = [0];
  const owns = [0];
  const tie = (bb: number, at: number) => {
    if (bb <= bbs[bbs.length - 1]! || at < owns[owns.length - 1]!) return;
    bbs.push(bb);
    owns.push(at);
  };
  for (const row of mounted) {
    if (row.rank === null || !exact.has(row.rank) || exact.get(row.rank) !== row) continue;
    tie(row.y, top[row.rank]!);
    tie(row.y + row.h, top[row.rank]! + hs[row.rank]!);
  }
  tie(Math.max(total, bbs[bbs.length - 1]! + 1), own);
  out.bbs = bbs;
  out.owns = owns;
  return out;
}

/**
 * How much scroller there is above the first item, when the data holds only the newest
 * pages of a thread: the first row on screen's place, less what the rows before it add up to.
 */
export function estimateLead(items: readonly Item[], mounted: readonly Mounted[]): number | null {
  for (const row of mounted) {
    if (row.rank === null || row.id.includes(":work-summary:")) continue;
    let before = 0;
    for (let rank = 0; rank < row.rank; rank++) before += items[rank]!.h;
    return Math.max(0, row.y - before);
  }
  return null;
}

/** Where `at` falls between the points `from` and `to` ties together, in the other pixels. */
function between(from: readonly number[], to: readonly number[], at: number): number {
  const last = from.length - 1;
  if (last < 1) return at;
  if (at <= from[0]!) return to[0]!;
  if (at >= from[last]!) return to[last]!;
  let lo = 0;
  let hi = last;
  // The last point at or before `at`.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid]! <= at) lo = mid;
    else hi = mid;
  }
  const span = from[hi]! - from[lo]!;
  return span <= 0 ? to[lo]! : to[lo]! + ((at - from[lo]!) / span) * (to[hi]! - to[lo]!);
}

/**
 * The layout in the scroller's pixels, the way a scrollbar's track is: rows on screen
 * keep their real places, the stretches between them are scaled to what the scroller
 * holds, and the whole spans the scroller's height. The slider then sits where the
 * native thumb does (a linear share of the scroll position) and the blocks under it are
 * the rows it covers. The conversions become the identity.
 */
export function inScrollerPixels(layout: Layout): Layout {
  if (layout.y.length === 0) return layout;
  const y: number[] = [];
  const h: number[] = [];
  layout.y.forEach((own, i) => {
    const from = between(layout.owns, layout.bbs, own);
    const to = between(layout.owns, layout.bbs, own + layout.h[i]!);
    y.push(from);
    h.push(Math.max(0, to - from));
  });
  const total = layout.bbs[layout.bbs.length - 1]!;
  return { ...layout, y, h, total, bbs: [0, Math.max(1, total)], owns: [0, Math.max(1, total)] };
}

/** A scroller position in the strip's own pixels. */
export function ownOf(layout: Layout, bb: number): number {
  return between(layout.bbs, layout.owns, bb);
}

/** A spot on the strip, in own pixels, as a scroller position. */
export function bbOf(layout: Layout, own: number): number {
  return between(layout.owns, layout.bbs, own);
}

/** The index of the rectangle at content offset `y`, or -1 when none holds it. */
export function rectAt(layout: Layout, y: number): number {
  let lo = 0;
  let hi = layout.y.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (layout.y[mid]! <= y) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Where a click on the strip should put the scroller: its centre at the point clicked. */
export function scrollForClick(layout: Layout, y: number, scale: number, viewport: number): number {
  return bbOf(layout, y / scale) - viewport / 2;
}

/** Where a drag puts the scroller: the slider's top at the pointer less where it was grabbed. */
export function scrollForDrag(layout: Layout, y: number, grab: number, scale: number): number {
  return bbOf(layout, (y - grab) / scale);
}
