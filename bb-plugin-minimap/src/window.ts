/**
 * Which lines the hover note builds and keeps. Pure, so the rules can be tested without a page: the note is a window
 * of `span` lines onto a list that has a line at each row's place among the rows the strip draws, and only the lines
 * a glide passes are built.
 */

/** A change of more than this many rows is a jump: the lines are cleared and the window set at once, since gliding past that many lines would only streak. */
export const FAR = 24;

/** The place the window starts at, for the pointer's row at `place`: its row in the middle, moved inward at either end of the thread so none of it is empty. */
export function windowStart(place: number, context: number, drawn: number): number {
  const span = 2 * context + 1;
  return Math.min(Math.max(0, place - context), Math.max(0, drawn - span));
}

/**
 * What a move of the window from `from` to `to` does to the lines held at `held`: which are dropped (far from the move),
 * which are brought up to date (held and on the way) and which are built (on the way and not held).
 */
export function planLines(held: Iterable<number>, from: number, to: number, span: number, drawn: number): { drop: number[]; refresh: number[]; build: number[] } {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(drawn - 1, Math.max(from, to) + span - 1);
  const have = new Set(held);
  const drop: number[] = [];
  for (const place of have) {
    if (place < lo - FAR || place > hi + FAR || place >= drawn) {
      drop.push(place);
      have.delete(place);
    }
  }
  const refresh: number[] = [];
  const build: number[] = [];
  for (let place = lo; place <= hi; place++) (have.has(place) ? refresh : build).push(place);
  return { drop, refresh, build };
}

/** Whether moving the window from `pos` to `start` is a jump (no glide, lines rebuilt) rather than a glide past the rows between. */
export function isJump(start: number, pos: number, animate: boolean): boolean {
  return !animate || Number.isNaN(pos) || Math.abs(start - pos) > FAR;
}
