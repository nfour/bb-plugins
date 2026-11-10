import { TWEEN_MAX, paintList, type Box } from "./boxes.ts";
import type { Kind } from "./model.ts";

/** How long a change to the picture takes to settle. */
const SETTLE_MS = 260;

/**
 * What puts a strip's rectangles on its canvas: sizes the canvas, paints the boxes in order, and
 * settles a change to the picture (each rectangle slides and resizes, new ones fade in, gone ones
 * fade out). It knows nothing of the page or the timeline: it is handed the boxes to show.
 */
export interface Painter {
  /** Shows `to` on `canvas`, `width` by `height` CSS px, with `palette` giving each kind's colour. */
  draw(canvas: HTMLCanvasElement, to: Map<string, Box>, width: number, height: number, palette: () => Record<Kind, string>): void;
  /** The canvas is gone or replaced: the next draw is a first one. */
  forget(): void;
  /** Stops a slide in progress. */
  stop(): void;
}

export function createPainter(): Painter {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  /** What is on the canvas now, by row id: where an animation starts from. */
  let current = new Map<string, Box>();
  let animation = 0;
  const size = { w: 0, h: 0, dpr: 0 };
  let live = false;

  const paint = (ctx: CanvasRenderingContext2D, boxes: Iterable<Box>, width: number, height: number, palette: Record<Kind, string>) => {
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    for (const box of paintList(boxes, height, size.dpr)) {
      ctx.globalAlpha = box.a;
      ctx.fillStyle = palette[box.kind];
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.globalAlpha = 1;
  };

  const moved = (a: Box, b: Box) => Math.abs(a.y - b.y) > 0.4 || Math.abs(a.h - b.h) > 0.4 || Math.abs(a.w - b.w) > 0.4 || a.kind !== b.kind;

  const stop = () => {
    cancelAnimationFrame(animation);
    animation = 0;
  };

  /** Moves what is on the canvas to `to`. */
  const settle = (ctx: CanvasRenderingContext2D, to: Map<string, Box>, width: number, height: number, palette: () => Record<Kind, string>) => {
    stop();
    const from = current;
    let changed = from.size !== to.size;
    if (!changed) for (const [id, box] of to) {
      const before = from.get(id);
      if (!before || moved(before, box)) {
        changed = true;
        break;
      }
    }
    if (!changed || from.size === 0 || to.size > TWEEN_MAX || reduceMotion.matches) {
      current = to;
      paint(ctx, to.values(), width, height, palette());
      return;
    }
    const start = performance.now();
    const step = (now: number) => {
      if (!live) return;
      const t = Math.min(1, (now - start) / SETTLE_MS);
      const e = 1 - (1 - t) * (1 - t) * (1 - t);
      const frame = new Map<string, Box>();
      for (const [id, box] of to) {
        const before = from.get(id);
        frame.set(
          id,
          before
            ? { kind: box.kind, x: before.x + (box.x - before.x) * e, y: before.y + (box.y - before.y) * e, w: before.w + (box.w - before.w) * e, h: before.h + (box.h - before.h) * e, a: 1 }
            : { ...box, a: e },
        );
      }
      const all = [...frame.values()];
      // Rectangles that are gone fade out where they were.
      for (const [id, box] of from) if (!to.has(id)) all.push({ ...box, a: 1 - e });
      current = t >= 1 ? to : frame;
      paint(ctx, all, width, height, palette());
      animation = t >= 1 ? 0 : requestAnimationFrame(step);
    };
    animation = requestAnimationFrame(step);
  };

  return {
    draw(canvas, to, width, height, palette) {
      live = true;
      const dpr = window.devicePixelRatio || 1;
      let resized = false;
      if (size.w !== width || size.h !== height || size.dpr !== dpr) {
        Object.assign(size, { w: width, h: height, dpr });
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        resized = true;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // A new size is a new picture, not a change to animate.
      if (resized) current = new Map();
      settle(ctx, to, width, height, palette);
    },
    forget() {
      stop();
      live = false;
      size.w = size.h = size.dpr = 0;
      current = new Map();
    },
    stop,
  };
}
