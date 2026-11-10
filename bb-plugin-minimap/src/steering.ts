import { rectAt, scrollForClick, scrollForDrag, type Layout } from "./model.ts";
import { rowById, type Timeline } from "./dom.ts";

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** What steering reads from the strip it belongs to, each time it needs it. */
export interface SteeringEnv {
  timeline(): Timeline | null;
  host(): HTMLElement | null;
  /** The viewport slider. */
  view(): HTMLElement | null;
  layout(): Layout;
  /** Strip pixels per layout pixel. */
  scale(): number;
  /** Asks the strip for a pass. */
  request(): void;
}

export interface Steering {
  onPointerDown(event: PointerEvent): void;
  onWheel(event: WheelEvent): void;
  /** Ends any follow in progress (the strip is going away). */
  cancel(): void;
}

/**
 * How the strip moves the timeline: a click jumps there and follows the row clicked while BB re-measures,
 * the slider drags, the wheel over the strip scrolls. Every write to the scroller is announced as the
 * reader's own, and any real input of theirs ends a follow.
 */
export function createSteering(env: SteeringEnv): Steering {
  /**
   * Writes the scroller's position. BB's scroll keeper writes a scroll it cannot
   * explain back to the bottom while it is attached there; a wheel event on the
   * scroller marks the next moments as the reader's own.
   */
  const scrollTo = (top: number) => {
    const timeline = env.timeline();
    if (!timeline) return;
    const { scroller } = timeline;
    scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
    scroller.scrollTop = Math.max(0, top);
  };

  let steering = 0;
  /**
   * After a click far away the rows between mount and BB replaces its estimates with
   * measurements, so the place clicked moves. This follows the row that was under the
   * click until it is on screen at the right height, then lets go.
   */
  const steer = async (id: string, within: number) => {
    const mine = ++steering;
    const stop = (event: Event) => {
      if (event.isTrusted && steering === mine) steering++;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of inputs) window.addEventListener(name, stop, { capture: true, passive: true });
    try {
      let settled = 0;
      const deadline = performance.now() + 1500;
      while (performance.now() < deadline && steering === mine && env.timeline()) {
        await nextFrame();
        const timeline = env.timeline();
        if (!timeline || steering !== mine) return;
        const row = rowById(timeline.items, id);
        if (!row) continue;
        const rect = row.getBoundingClientRect();
        const scroller = timeline.scroller.getBoundingClientRect();
        const delta = rect.top + within * rect.height - (scroller.top + timeline.scroller.clientHeight / 2);
        if (Math.abs(delta) <= 1) {
          if (++settled >= 10) return;
          continue;
        }
        settled = 0;
        scrollTo(timeline.scroller.scrollTop + delta);
      }
    } finally {
      for (const name of inputs) window.removeEventListener(name, stop, { capture: true });
    }
  };

  return {
    onPointerDown(event) {
      const host = env.host();
      const timeline = env.timeline();
      const view = env.view();
      if (event.button !== 0 || !host || !timeline || !view) return;
      event.preventDefault();
      steering++;
      const { scroller } = timeline;
      const localY = (e: PointerEvent) => e.clientY - host.getBoundingClientRect().top;
      const y = localY(event);
      const thumb = view.getBoundingClientRect();
      const onThumb = event.target === view;
      // Grabbing the slider keeps its place under the pointer; a click elsewhere puts its middle there.
      let grab = onThumb ? event.clientY - thumb.top : thumb.height / 2;
      if (!onThumb) {
        const layout = env.layout();
        const scale = env.scale();
        scrollTo(scrollForClick(layout, y, scale, scroller.clientHeight));
        const at = rectAt(layout, y / scale);
        if (at >= 0) void steer(layout.ids[at]!, Math.min(1, Math.max(0, (y / scale - layout.y[at]!) / Math.max(1, layout.h[at]!))));
        grab = thumb.height / 2;
      }
      host.dataset.drag = "";
      host.setPointerCapture(event.pointerId);
      let pending = -1;
      let frame = 0;
      const move = (e: PointerEvent) => {
        if (!onThumb) steering++;
        pending = scrollForDrag(env.layout(), localY(e), grab, env.scale());
        if (frame === 0) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            scrollTo(pending);
          });
        }
      };
      const end = () => {
        host.removeEventListener("pointermove", move);
        host.removeEventListener("pointerup", end);
        host.removeEventListener("pointercancel", end);
        cancelAnimationFrame(frame);
        delete host.dataset.drag;
        env.request();
      };
      host.addEventListener("pointermove", move);
      host.addEventListener("pointerup", end);
      host.addEventListener("pointercancel", end);
    },
    onWheel(event) {
      const timeline = env.timeline();
      if (!timeline) return;
      event.preventDefault();
      steering++;
      const { scroller } = timeline;
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroller.clientHeight : 1;
      scrollTo(scroller.scrollTop + event.deltaY * lines);
    },
    cancel() {
      steering++;
    },
  };
}
