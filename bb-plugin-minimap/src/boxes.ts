import type { Kind, Layout } from "./model.ts";

/** The rectangles run to the strip's left edge and stop this far short of the right one, which breaks the strip up from the page. */
const RIGHT_MARGIN = 2;
/** How wide each kind's rectangle is, as a share of the strip's inner width (a user's is its own). */
const SHARE: Record<Kind, number> = { user: 1, reply: 1, work: 0.6, error: 1, system: 0.4 };
const ALIGN: Record<Kind, "left" | "right"> = { user: "right", reply: "left", work: "left", error: "left", system: "left" };
/** Your messages and errors are landmarks: they are drawn over the rest and never thinner than two device pixels. */
const LANDMARK: Record<Kind, boolean> = { user: true, reply: false, work: false, error: true, system: false };
/** More rectangles than this are painted without the slide: it would cost more than it shows. */
export const TWEEN_MAX = 1500;

/**
 * A rectangle as it is on the canvas: its place and size in strip pixels, and how solid it
 * is while it fades in (new) or out (gone).
 */
export interface Box {
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
  a: number;
}

/** One row's rectangle on the strip, as it is drawn. */
export function boxAt(layout: Layout, i: number, scale: number, width: number, dpr: number): Box {
  const kind = layout.kinds[i]!;
  const inner = width - RIGHT_MARGIN;
  const h = layout.h[i]! * scale;
  // A gap between rectangles that are big enough to show one; tiny ones merge into a band.
  let drawnH = Math.max(1, h >= 4 ? h - 1 : h);
  if (LANDMARK[kind]) drawnH = Math.max(drawnH, 2 / dpr);
  const w = Math.min(inner, Math.max(kind === "user" ? 8 : 2, inner * (kind === "user" ? layout.w[i]! : SHARE[kind])));
  const x = ALIGN[kind] === "right" ? width - RIGHT_MARGIN - w : 0;
  return { kind, x, y: layout.y[i]! * scale, w, h: drawnH, a: 1 };
}

/** The layout as boxes on the strip, only those that are on it and of a kind that is shown. */
export function boxesOf(layout: Layout, scale: number, width: number, height: number, show: Record<Kind, boolean>, dpr: number): Map<string, Box> {
  const out = new Map<string, Box>();
  for (let i = 0; i < layout.y.length; i++) {
    if (layout.y[i]! * scale > height) break;
    if (!show[layout.kinds[i]!]) continue;
    out.set(layout.ids[i]!, boxAt(layout, i, scale, width, dpr));
  }
  return out;
}

/** What a box is worth keeping when others share its device row. */
const worth = (box: Box) => (box.kind === "error" ? 1e6 : 0) + (LANDMARK[box.kind] ? box.w : box.w * box.h);

/**
 * The boxes in the order they are painted: everything else first, then your messages and errors over it,
 * so a long reply never covers the landmark above it. When there are more boxes than the strip has pixel
 * rows to show, each layer keeps one box per device row (an error over a message; otherwise the widest
 * message, as its width is its content, or the largest of the rest), which bounds the work by twice the
 * rows, however long the thread.
 */
export function paintList(boxes: Iterable<Box>, height: number, dpr: number): Box[] {
  const all = Array.isArray(boxes) ? (boxes as Box[]) : [...boxes];
  const layers: Box[][] = [[], []];
  for (const box of all) layers[LANDMARK[box.kind] ? 1 : 0]!.push(box);
  if (all.length * 2 <= height * dpr) return [...layers[0]!, ...layers[1]!];
  const out: Box[] = [];
  for (const layer of layers) {
    const best = new Map<number, Box>();
    for (const box of layer) {
      const key = Math.floor(box.y * dpr);
      const kept = best.get(key);
      if (!kept || worth(box) > worth(kept)) best.set(key, box);
    }
    // Rows were walked top to bottom, so the Map's order is already by position.
    out.push(...best.values());
  }
  return out;
}
