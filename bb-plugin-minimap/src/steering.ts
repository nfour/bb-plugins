import { glideStep, rectAt, scrollForClick, scrollForDrag, type Layout } from "./model.ts";
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
  /** How clicks and the wheel move the timeline, read when they happen. */
  config(): { clickSmooth: boolean; wheelSmooth: boolean; wheelSpeed: number };
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

  /**
   * The wheel's glide is our own: each frame the scroller moves a share of the way to where the steps have added up to,
   * so a step that arrives mid-glide only moves the target and the motion never restarts or pauses (a native smooth
   * scroll started again at every event eases in again each time).
   */
  const GLIDE_MS = 90;
  /** How far the pointer must travel from a click before it counts as a drag. */
  const DRAG_PX = 4;
  let wheelTarget = 0;
  let wheelFrame = 0;
  let wheelLast = 0;
  /** Where the glide has got to (the scroller itself may round it) and what the scroller read back after our last write. */
  let wheelPos = 0;
  let wheelSeen = 0;
  /** The reader's own input ends the glide, so it never pulls against them. Our own events are not trusted. */
  const GLIDE_STOPS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  const onReader = (event: Event) => {
    // The strip's own wheel steps are what feed the glide.
    if (event.isTrusted && !env.host()?.contains(event.target as Node)) stopGlide();
  };
  function stopGlide() {
    cancelAnimationFrame(wheelFrame);
    wheelFrame = 0;
    for (const name of GLIDE_STOPS) window.removeEventListener(name, onReader, { capture: true });
  }
  const glide = (now: number) => {
    wheelFrame = 0;
    const timeline = env.timeline();
    if (!timeline) return stopGlide();
    const { scroller } = timeline;
    // Something else moved the scroller (BB re-measuring rows above): carry the glide along rather than pull against it.
    const moved = scroller.scrollTop - wheelSeen;
    const bottom = scroller.scrollHeight - scroller.clientHeight;
    // A jump to the very bottom from somewhere else is BB's scroll keeper undoing a write it did not take for the reader's
    // (a slow frame outlasts its window for that): it is written again, not followed, or the glide would end at the bottom.
    const snapped = scroller.scrollTop >= bottom - 1 && wheelSeen < bottom - 1;
    if (Math.abs(moved) > 1 && !snapped) {
      wheelPos += moved;
      wheelTarget += moved;
    }
    wheelTarget = Math.min(Math.max(0, wheelTarget), Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    wheelPos = glideStep(wheelPos, wheelTarget, Math.min(64, Math.max(1, now - wheelLast)), GLIDE_MS);
    wheelLast = now;
    scrollTo(wheelPos);
    wheelSeen = scroller.scrollTop;
    if (wheelPos === wheelTarget) return stopGlide();
    wheelFrame = requestAnimationFrame(glide);
  };

  /** Starts the glide towards `target`, or moves the target of one that is going. */
  const aim = (scroller: HTMLElement, target: number) => {
    wheelTarget = Math.min(Math.max(0, target), Math.max(0, scroller.scrollHeight - scroller.clientHeight));
    if (wheelFrame === 0) {
      wheelPos = wheelSeen = scroller.scrollTop;
      wheelLast = performance.now() - 16;
      wheelFrame = requestAnimationFrame(glide);
      for (const name of GLIDE_STOPS) window.addEventListener(name, onReader, { capture: true, passive: true });
    }
  };

  let steering = 0;
  /**
   * After a click far away the rows between mount and BB replaces its estimates with
   * measurements, so the place clicked moves. This follows the row that was under the
   * click until it is on screen at the right height, then lets go.
   */
  const steer = async (id: string, within: number, aimed: number, glide = false) => {
    const mine = ++steering;
    const stop = (event: Event) => {
      if (event.isTrusted && steering === mine) steering++;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of inputs) window.addEventListener(name, stop, { capture: true, passive: true });
    try {
      // The glide is left to arrive before the follow starts: the follow's writes would cut it short.
      if (glide) {
        const limit = performance.now() + 2500;
        while (wheelFrame !== 0 && performance.now() < limit && steering === mine) await nextFrame();
      }
      let settled = 0;
      const deadline = performance.now() + 1500;
      while (performance.now() < deadline && steering === mine && env.timeline()) {
        await nextFrame();
        const timeline = env.timeline();
        if (!timeline || steering !== mine) return;
        const row = rowById(timeline.items, id);
        if (!row) {
          // Not on screen: BB's scroll keeper may have put the scroller back at the bottom after the write (a slow frame
          // outlasts the window in which it takes a write for the reader's), so the place aimed at is written again.
          if (Math.abs(timeline.scroller.scrollTop - aimed) > 1 && !(glide && wheelFrame !== 0)) scrollTo(aimed);
          continue;
        }
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
      stopGlide();
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
        const glide = env.config().clickSmooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const target = scrollForClick(layout, y, scale, scroller.clientHeight);
        // Our own glide, not the browser's smooth scroll: that one is cut short whenever BB swaps the estimated height of
        // rows for measured ones under it, which it does all the way to a place not loaded yet (a click ended 10% of the way).
        if (glide) aim(scroller, target);
        else scrollTo(target);
        const at = rectAt(layout, y / scale);
        if (at >= 0) void steer(layout.ids[at]!, Math.min(1, Math.max(0, (y / scale - layout.y[at]!) / Math.max(1, layout.h[at]!))), target, glide);
        grab = thumb.height / 2;
      }
      host.dataset.drag = "";
      host.setPointerCapture(event.pointerId);
      let pending = -1;
      let frame = 0;
      // A click that wobbles a pixel or two is still a click: only a real drag takes over from the glide.
      let dragging = onThumb;
      const move = (e: PointerEvent) => {
        if (!dragging) {
          if (Math.hypot(e.clientX - event.clientX, e.clientY - event.clientY) < DRAG_PX) return;
          dragging = true;
        }
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
      const config = env.config();
      const step = event.deltaY * lines * (config.wheelSpeed / 100);
      const smooth = config.wheelSmooth && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!smooth) {
        stopGlide();
        scrollTo(scroller.scrollTop + step);
        return;
      }
      // Steps that come while a glide is still going add to where it is heading, not to where it has got to.
      aim(scroller, (wheelFrame !== 0 ? wheelTarget : scroller.scrollTop) + step);
    },
    cancel() {
      steering++;
      stopGlide();
    },
  };
}
