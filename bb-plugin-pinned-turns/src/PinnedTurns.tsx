import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { findTimeline, mountedRows, prefersReducedMotion, rankOfRow, rowById, type Timeline } from "./dom";
import { PIN_ROW_HEIGHT, bandAt, jumpOffset, lastAtOrAbove, type Message, type TurnStatus } from "./model";
import { useOptions } from "./options";
import { useOutline, useTimeline, type Debug, type TimelineIndex } from "./timeline";
import { COUNTER_ROOM, setCounterRoom, useCounterRoom, useTabVisible } from "./viewport";

/**
 * Where a jump leaves a row, as an offset from the scroller's top. The bar's
 * drawn bottom edge is about 38px down, so this leaves it ~10px of clearance.
 */
const LANDING = PIN_ROW_HEIGHT;
/** The corner radius of BB's own message bubble; the bar lifts its top corners by this much. */
const RADIUS = 12;
/**
 * The timeline column's own 16px side padding: the bar is exactly as wide as the
 * text, so it lines up with it at every window width. BB's TOC strip sits at the
 * vertical middle of the right edge, not at the top, so it does not meet the bar.
 */
const SIDE_ROOM = 16;

interface Shown {
  message: Message | null;
  reply: Message | null;
}
const NONE: Shown = { message: null, reply: null };

const sameMessage = (a: Message | null, b: Message | null) =>
  a === b || (a?.id === b?.id && a?.title === b?.title && a?.full === b?.full && a?.status === b?.status);

/** The newest user message held, whose change is what can change the turn count. */
function newestUser(index: TimelineIndex): string | undefined {
  for (let i = index.messages.length - 1; i >= 0; i--) if (index.messages[i]!.role === "user") return index.messages[i]!.id;
  return undefined;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * The bar. It is a zero-height row stuck to the top, the first child of the scroller's
 * frame, so the timeline's layout and scroll height do not change; the rows are
 * never stuck there (they would pile up). One paint per animation frame, driven
 * by scroll and by the items resizing: nothing polls.
 */
export function PinnedTurns({ threadId }: { threadId: string }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState<Shown>(NONE);
  const roomForCounter = useCounterRoom();
  const options = useOptions();
  const rpc = useRpc<typeof rpcContract>();
  // The server drops these unless the debug log is on; skipping the call here saves the round trip.
  const debug = useCallback<Debug>(
    (event, data) => {
      if (options.debugLog) rpc.call("debug", { event, data }).catch(() => {});
    },
    [rpc, options.debugLog],
  );
  const log = useRef(debug);
  log.current = debug;
  // Rows and the tally are read only while the bar is on the page and the tab is in view.
  const active = useTabVisible() && host !== null;
  const { index, loadOlder } = useTimeline(threadId, debug, active);
  const live = useRef({ timeline: null as Timeline | null, index: null as TimelineIndex | null, frame: 0, jump: 0 });
  const paint = useRef(() => {});

  const schedule = useCallback(() => {
    const l = live.current;
    if (l.frame !== 0) return;
    l.frame = requestAnimationFrame(() => {
      l.frame = 0;
      paint.current();
    });
  }, []);

  // What the bar says depends on where the reader is (the boundary row, found by
  // searching the mounted rows' tops) and on the timeline data (everything above it).
  paint.current = () => {
    const { timeline, index: known } = live.current;
    if (!timeline || !known || !timeline.scroller.isConnected) return;
    const rows = mountedRows(timeline.items);
    const pinTop = timeline.scroller.getBoundingClientRect().top;
    // A message is named from the moment its top reaches the scroller's top edge,
    // not before: any lower and the bar repeats a bubble that is still on screen
    // just beneath it.
    const line = pinTop;
    const at = lastAtOrAbove(rows.length, (i) => rows[i]!.getBoundingClientRect().top, line);
    const rank = at < 0 ? null : rankOfRow(rows, at, known.rank);
    let next = NONE;
    if (rank !== null) {
      next = bandAt(known.messages, rank);
      // A half is missing and older rows are not fetched: it is further up.
      if ((next.message === null || next.reply === null) && known.hasOlder) loadOlder();
    } else if (at >= 0 && known.hasOlder) loadOlder();
    setShown((prev) => (sameMessage(prev.message, next.message) && sameMessage(prev.reply, next.reply) ? prev : next));
  };

  useEffect(() => {
    live.current.index = index;
    schedule();
  }, [index, schedule]);

  const counter = options.showPosition && roomForCounter;
  const tally = useOutline(threadId, counter, active, newestUser(index));

  // Park the row in the scroller and keep it parked. The scroller can be rebuilt
  // under a thread (a layout change), so a cheap check re-attaches when it is gone.
  useEffect(() => {
    let timeline: Timeline | null = null;
    let element: HTMLElement | null = null;
    let observer: ResizeObserver | null = null;
    const l = live.current;

    const detach = () => {
      if (timeline) log.current("detach", { scrollerConnected: timeline.scroller.isConnected, itemsConnected: timeline.items.isConnected });
      observer?.disconnect();
      timeline?.scroller.removeEventListener("scroll", schedule);
      element?.remove();
      timeline = element = observer = null;
      l.timeline = null;
      setHost(null);
    };
    const attach = () => {
      if (timeline && element && timeline.scroller.isConnected && timeline.items.isConnected && element.parentElement === timeline.frame) return;
      detach();
      const found = findTimeline(threadId);
      if (!found) return;
      timeline = found;
      element = document.createElement("div");
      element.style.cssText = "position:sticky;top:0;height:0;z-index:20;pointer-events:none";
      found.frame.insertBefore(element, found.frame.firstChild);
      found.scroller.addEventListener("scroll", schedule, { passive: true });
      observer = new ResizeObserver(() => {
        setCounterRoom(found.scroller.clientWidth >= COUNTER_ROOM);
        schedule();
      });
      observer.observe(found.items);
      observer.observe(found.scroller);
      l.timeline = found;
      log.current("attach", { rows: found.items.children.length });
      setHost(element);
      schedule();
    };
    attach();
    const timer = window.setInterval(attach, 500);
    return () => {
      window.clearInterval(timer);
      cancelAnimationFrame(l.frame);
      l.frame = 0;
      detach();
      setShown(NONE);
    };
  }, [threadId, schedule]);

  /**
   * Scroll the row to its landing, steering by where the row is *now*.
   *
   * A single `scrollTo` aims at where the row was when it started, and BB moves
   * the row on the way: rows mount and unmount as the scroll passes, and their
   * measured heights replace estimates, so the row ends up somewhere else and the
   * page visibly corrects itself afterwards. Instead each frame closes a share of
   * the distance that is left to the row's current position, so a shift is
   * absorbed as it happens. A row that is windowed out is headed for a screen at a
   * time, which mounts the rows on the way; the page's address and history are
   * never touched. The reader's own input ends it at once.
   */
  const jump = async (target: Message) => {
    const l = live.current;
    if (!l.timeline) return;
    const mine = ++l.jump;
    // Only the reader's own input ends it, not the wheel events the jump sends itself.
    const stop = (event: Event) => {
      if (event.isTrusted && l.jump === mine) l.jump++;
    };
    const inputs = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const name of inputs) window.addEventListener(name, stop, { capture: true, passive: true });
    const ease = prefersReducedMotion() ? 1 : 0.22;
    let settled = 0;
    let stuck = 0;
    let outcome = "timeout";
    const began = performance.now();
    try {
      const deadline = performance.now() + 5000;
      while (performance.now() < deadline && l.jump === mine) {
        const now = l.timeline;
        if (!now) {
          outcome = "lost";
          return;
        }
        const { scroller, items } = now;
        const row = rowById(items, target.id);
        let step: number;
        if (row) {
          const delta = jumpOffset(row.getBoundingClientRect().top, scroller.getBoundingClientRect().top, LANDING);
          if (Math.abs(delta) <= 1) {
            // Arrived; watch a moment longer for a late shift before letting go.
            if (++settled >= 20) {
              outcome = "settled";
              return;
            }
            await nextFrame();
            continue;
          }
          settled = 0;
          step = Math.sign(delta) * Math.min(Math.abs(delta), Math.max(1, Math.min(Math.abs(delta) * ease, scroller.clientHeight * 1.5)));
        } else {
          // Windowed out: which way it lies is read from where the mounted rows stand in the thread.
          const rows = mountedRows(items);
          const known = l.index;
          const here = known && rows.length > 0 ? rankOfRow(rows, rows.length - 1, known.rank) : null;
          if (here === null) {
            await nextFrame();
            continue;
          }
          step = Math.sign(target.rank - here) * scroller.clientHeight * 0.8;
        }
        const before = scroller.scrollTop;
        // BB's scroll keeper (0.48) writes a scroll it cannot explain back to the
        // bottom while it is attached there; a wheel event on the scroller marks the
        // next 150ms as the reader's input, so it follows the jump and detaches.
        scroller.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
        scroller.scrollTop += step;
        // At the edge of the page the row cannot be brought any nearer (the first message sits under the bar).
        if (scroller.scrollTop === before && ++stuck >= 4) {
          outcome = "edge";
          return;
        }
        if (scroller.scrollTop !== before) stuck = 0;
        await nextFrame();
      }
    } finally {
      for (const name of inputs) window.removeEventListener(name, stop, { capture: true });
      if (l.jump !== mine) outcome = "cancelled";
      log.current("jump", { to: target.role, outcome, ms: Math.round(performance.now() - began) });
    }
  };

  if (!host) return null;
  const nth = shown.message && tally?.ordinals.get(shown.message.id);
  return createPortal(
    // The message is the reader's own bubble, so it sits right at its own width; the
    // reply takes every pixel it leaves. Nothing is measured to keep them apart.
    <div
      className="pinned-bar"
      style={{ margin: "0 auto", maxWidth: `min(728px, calc(100% - ${SIDE_ROOM * 2}px))` }}
    >
      <Half message={shown.reply} onJump={jump} className="pinned-half--reply" ink={REPLY_INK} status={options.showStatus} tooltip={options.showFullText} />
      <Half
        message={shown.message}
        onJump={jump}
        className="pinned-half--message"
        glide
        ink={MESSAGE_INK}
        status={options.showStatus}
        tooltip={options.showFullText}
        position={tally && nth ? { nth, total: tally.total } : undefined}
      />
    </div>,
    host,
  );
}

/** BB's message bubble ink, made opaque: `--surface-recessed` is translucent and lets the text beneath through. */
const MESSAGE_INK = "var(--surface-recessed-solid)";
/**
 * The reply has no bubble in the timeline, so its half sits between the chat
 * background and the bubble in either theme: less foreground mixed in than the
 * bubble's 6%.
 */
const REPLY_INK = "color-mix(in oklab, var(--foreground) 3%, var(--background))";

/** A mark for a turn that ended badly. A turn in progress is shown by pulsing the text instead. */
const STATUS_DOT: Record<Exclude<TurnStatus, "pending">, { color: string; label: string }> = {
  error: { color: "#d4493a", label: "This turn ended in an error" },
  interrupted: { color: "#c98a1a", label: "This turn was interrupted" },
};

/** How long a half takes to change width for its new text. */
const GLIDE_MS = 100;

/**
 * Animates an element's width between texts. `key` is what the element shows (undefined
 * turns this off); when it changes, the width runs from where it was, or is still
 * in flight, to the width the new text needs. The element is only ever animated by the
 * Web Animations API, so it stays `width: auto` the rest of the time.
 */
function useGlide(box: React.RefObject<HTMLDivElement | null>, key: string | undefined) {
  const state = useRef({ width: 0, anim: null as Animation | null });
  // Track the settled width so a change of window size does not leave a stale starting point.
  useEffect(() => {
    const el = box.current;
    if (!el || key === undefined) return;
    const observer = new ResizeObserver(() => {
      if (!state.current.anim) state.current.width = el.getBoundingClientRect().width;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [box, key === undefined]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || key === undefined) return;
    const s = state.current;
    // Mid-glide, start from the width on screen now; otherwise from the last settled one.
    const from = s.anim ? el.getBoundingClientRect().width : s.width;
    s.anim?.cancel();
    s.anim = null;
    const to = el.getBoundingClientRect().width;
    s.width = to;
    if (from === 0 || Math.abs(from - to) < 1 || prefersReducedMotion()) return;
    const animation = el.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: GLIDE_MS, easing: "cubic-bezier(0, 0, 0.58, 1)" });
    s.anim = animation;
    const done = () => {
      if (s.anim === animation) s.anim = null;
    };
    animation.onfinish = done;
    animation.oncancel = done;
  }, [box, key]);
}

/**
 * One half of the bar. It holds its slot when it has nothing to say, fading out
 * through the top edge, so the pair does not shift as the reader scrolls; the
 * last text stays until it has gone.
 */
function Half({
  message,
  ink,
  className,
  status,
  tooltip,
  position,
  glide,
  onJump,
}: {
  message: Message | null;
  ink: string;
  className: string;
  /** Show the turn's status on this half: it pulses while the turn runs; the reply alone also carries failed/interrupted. */
  status?: boolean;
  /** Offer the full text on hover when the bar cut it short. */
  tooltip: boolean;
  /** Where this message sits among the thread's, drawn outside the half's right edge. */
  position?: { nth: number; total: number };
  /**
   * Ease the half's width to the new text's when it changes, instead of snapping. Only
   * the message half sizes itself to its text; the reply takes what is left, so it
   * follows without being animated itself.
   */
  glide?: boolean;
  onJump: (message: Message) => void;
}) {
  const last = useRef<Message | null>(null);
  if (message) last.current = message;
  const text = message ?? last.current;
  const box = useRef<HTMLDivElement>(null);
  useGlide(box, glide ? text?.title : undefined);
  const turn = status ? text?.status : undefined;
  const dot = turn && turn !== "pending" ? STATUS_DOT[turn] : null;
  const busy = turn === "pending";
  const what = text?.role === "assistant" ? "the latest reply" : text?.by === "system" ? "a system message" : "your message";
  // The label stands in for the button's content, so everything the sighted see is said in it.
  const notes = [busy && "still working", dot?.label, position && `${position.nth} of ${position.total}`].filter(Boolean);
  return (
    <div
      ref={box}
      className={`pinned-half ${className}`}
      data-empty={message ? undefined : ""}
      style={{ pointerEvents: message ? "auto" : "none" }}
    >
      <button
        type="button"
        tabIndex={message ? 0 : -1}
        aria-hidden={!message}
        aria-label={text ? `Jump to ${what}${notes.length > 0 ? ` (${notes.join(", ")})` : ""}: ${text.title}` : undefined}
        onClick={() => message && onJump(message)}
        // Lifted by its own radius so the top corners sit above the scroller's edge
        // and the bar reads as hanging from it; the top padding is the lift plus a
        // small gap, so hiding the corners costs no space you can see.
        className="pinned-button"
        style={{ background: ink, marginTop: -RADIUS, paddingTop: RADIUS + 5 }}
      >
        {dot ? (
          <span
            title={dot.label}
            aria-hidden
            className="pinned-dot"
            style={{ background: dot.color }}
          />
        ) : null}
        <span
          className="pinned-text"
          data-busy={busy ? "" : undefined}
          // Only when the bar cut the text short; a native tooltip on a whole line is noise.
          onMouseEnter={(event) => {
            const el = event.currentTarget;
            const cut = tooltip && text && el.scrollWidth > el.clientWidth;
            if (cut) el.title = text.full;
            else el.removeAttribute("title");
          }}
        >
          {text?.title}
        </span>
      </button>
      {/* Hangs off the right edge so it never takes width from the message (see COUNTER_ROOM). */}
      {position ? (
        // The same size and line height as the message's text, with the smaller figures
        // inside it, so the two share a baseline.
        <span
          aria-hidden
          className="pinned-position"
          style={{ left: "100%", marginLeft: 10, top: 6, opacity: 0.33 }}
        >
          <span style={{ fontSize: "90%" }}>
            <b>{position.nth}</b>/{position.total}
          </span>
        </span>
      ) : null}
    </div>
  );
}
