import {
  EMPTY_LAYOUT,
  KINDS,
  buildLayout,
  estimateLead,
  inScrollerPixels,
  foldedHeights,
  dataIdOf,
  kindOfDomId,
  ownOf,
  scaleFor,
  type Kind,
  type Layout,
  type Measure,
  type Mounted,
} from "./model.ts";
import { bubbleShare, findTimeline, mountedRows, type Timeline } from "./dom.ts";
import type { Rows } from "./timeline.ts";
import { recall, remember } from "./remember.ts";
import { boxAt, boxesOf } from "./boxes.ts";
import { createPainter } from "./painter.ts";
import { createSteering } from "./steering.ts";
import { createTip } from "./tip.ts";

export interface Options {
  /** Hide the scroller's own scrollbar while the strip shows; the strip takes its place. */
  hideScrollbar: boolean;
  /** Hide BB's thread-index button; off, it is moved to the left of the strip. */
  hideToc: boolean;
  /** The strip's width in px. */
  width: number;
  /** Keep the strip, at `narrowWidth`, on a window too narrow for `width`, instead of handing back to the scrollbar. */
  keepNarrow: boolean;
  narrowWidth: number;
  /** Take the strip away while the thread fits on screen with nothing to scroll, as the scrollbar goes. */
  hideWhenFits: boolean;
  /** Show a note with the row under the pointer. */
  hoverPreview: boolean;
  /** Which kinds of rectangle are drawn, and a colour for each ("" is the theme's). */
  show: Record<Kind, boolean>;
  colors: Record<Kind, string>;
  /** Draw the slider over what is on screen. */
  showOutline: boolean;
  /** Dim the strip until the pointer is over it. */
  fadeIdle: boolean;
  /** 0 to 1: the strip's opacity, and with fading on the one it returns to under the pointer. */
  opacity: number;
  /** 0 to 1: the opacity while faded. */
  idleOpacity: number;
  /** With the native scrollbar kept: stop BB fading it out after scrolling. */
  keepScrollbar: boolean;
  /** The viewport slider's look: round corners, line strength 0 to 1, thickness in px, "#rrggbb" or "" for the theme. */
  sliderRound: boolean;
  sliderOpacity: number;
  sliderThickness: number;
  sliderColor: string;
}

export interface Strip {
  /** Called when the scroller holds history the strip has no rows for (true) and when it has caught up (false). */
  onNeed(callback: (need: boolean) => void): void;
  /** Called when the strip starts or stops being on screen (too narrow a window, or taken away). */
  onShown(callback: (shown: boolean) => void): void;
  setRows(rows: Rows): void;
  setOptions(options: Options): void;
  dispose(): void;
}

/** The room BB's thread-index button takes beside the strip when it is kept (32px and a gap). */
const TOC_ROOM = 40;
/** What a native scrollbar takes at the edge when it is kept. */
const BAR_ROOM = 10;
/** Where a kept native scrollbar's track starts and ends, inside the scroller: the strip is inset by this much at the top and bottom so its slider moves in step with the scrollbar's thumb. */
const BAR_INSET = 11;
/** The least gap between the message column and the strip, or the strip is left out. */
const MIN_GAP = 8;
/** Scroller pixels of unread history above the first row that are tolerated before older pages are fetched for it (estimates are never exact). */
const LEAD_SLACK = 120;
/** A pass (reading the page, drawing) happens at most this often while the thread is changing. */
const PASS_EVERY_MS = 250;
/** After a scroll stops, rows that mounted along the way are read once. */
const SCROLL_IDLE_MS = 140;

const CLASS = "minimap";

/**
 * The strip beside one thread's timeline: one canvas drawn when the thread's shape
 * changes, and a slider moved by its position as it scrolls. Nothing here runs per
 * keystroke or per frame of a scroll except the slider's one move; the rows are
 * read when the page reports a size change (at most four times a second) and once a scroll
 * has stopped.
 */
export function createStrip(threadId: string, initial: Options): Strip {
  let options = initial;
  let rows: Rows | null = null;
  let timeline: Timeline | null = null;
  let host: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let view: HTMLDivElement | null = null;
  let probes: Partial<Record<Kind, HTMLElement>> = {};
  let colors: Record<Kind, string> | null = null;
  let observer: ResizeObserver | null = null;
  let layout: Layout = EMPTY_LAYOUT;
  /**
   * Scroller pixels above the first row the data holds: older history that this strip has no
   * rows for (a page not read, or one BB has loaded since). Exact whenever the first row is on
   * screen, estimated from the first time anything is, and kept between: the scroller's own
   * estimate for it keeps changing as rows are measured, and the strip should not move with it.
   */
  let lead = 0;
  let leadFor = "";
  const leadOf = (mounted: Mounted[]): number => {
    const items = rows?.items ?? [];
    if (!rows || !rows.hasOlder || items.length === 0) return (lead = 0);
    const top = mounted.find((row) => row.rank === 0 && !row.id.includes(":work-summary:"));
    if (top) {
      lead = top.y;
      leadFor = items[0]!.id;
    } else if (items[0]!.id !== leadFor) {
      // Nothing known about the first row yet: a guess from the first row on screen, until it is seen.
      const guess = estimateLead(items, mounted);
      if (guess !== null) {
        lead = guess;
        leadFor = items[0]!.id;
      }
    }
    return lead;
  };

  let shownCallback: ((shown: boolean) => void) | null = null;
  let needed = false;
  let needCallback: ((need: boolean) => void) | null = null;
  let shown = false;
  let barHidden = false;
  let barKept = false;
  // Returning to a thread starts from the sizes its strip learned last time; the first pass drops them if the column's width has changed.
  const recalled = recall(threadId);
  const cache = new Map<string, Measure>(recalled?.cache);
  let columnWidth = recalled?.columnWidth ?? 0;
  let disposed = false;
  // `localStorage["minimap:debug"]` leaves the last layout on `window.__minimap` for inspection.
  const debug = localStorage.getItem("minimap:debug") !== null;
  let passes = 0;

  // What the last pass put on the strip, so an unchanged value is not written again.
  const drawn = { top: -1, right: -1, height: -1, hostW: -1 };
  /** The width the strip has now: `options.width`, or the narrow one on a window too small for it. */
  let width = options.width;
  let scale = 0.1;
  /** The strip's own height: the scroller's, less the insets while the native scrollbar is kept. */
  let stripH = 0;
  const painter = createPainter();

  /** ---- attaching ---- */

  const detach = () => {
    tip.detach();
    observer?.disconnect();
    timeline?.scroller.removeEventListener("scroll", onScroll);
    host?.remove();
    freeToc();
    if (timeline && barHidden) timeline.scroller.style.removeProperty("scrollbar-width");
    if (timeline && barKept) timeline.scroller.style.removeProperty("scrollbar-color");
    barHidden = barKept = false;
    timeline = host = canvas = view = observer = null;
    probes = {};
    colors = null;
    if (shown) shownCallback?.(false);
    shown = false;
    painter.forget();
    drawn.hostW = -1;
    drawn.top = drawn.right = drawn.height = -1;
  };

  const attach = () => {
    if (timeline && host && timeline.scroller.isConnected && timeline.items.isConnected && host.parentElement === timeline.scroller.parentElement) return;
    detach();
    const found = findTimeline(threadId);
    const parent = found?.scroller.parentElement;
    if (!found || !parent) return;
    timeline = found;
    host = document.createElement("div");
    host.className = CLASS;
    // The keyword is built from two strings: written whole, the plugin build would turn the word
    // anywhere in this folder into a page-wide rule that BB's own elements match.
    host.style.setProperty("--minimap-pos", ["abs", "olute"].join(""));
    host.dataset.off = "";
    host.setAttribute("role", "presentation");
    canvas = document.createElement("canvas");
    canvas.className = `${CLASS}-canvas`;
    view = document.createElement("div");
    view.className = `${CLASS}-view`;
    host.append(canvas, view);
    for (const kind of KINDS) {
      const probe = document.createElement("i");
      probe.className = `${CLASS}-ink`;
      probe.dataset.kind = kind;
      host.append(probe);
      probes[kind] = probe;
    }
    applyOptions();
    parent.append(host);
    found.scroller.addEventListener("scroll", onScroll, { passive: true });
    tip.attach(host);
    host.addEventListener("pointerdown", steering.onPointerDown);
    host.addEventListener("wheel", steering.onWheel, { passive: false });
    observer = new ResizeObserver(() => request());
    observer.observe(found.frame);
    observer.observe(found.scroller);
    request();
  };

  /** BB's thread-index button, kept out of the strip's way: moved left of it, or removed from view. */
  let toc: HTMLElement | null = null;
  const freeToc = () => {
    toc?.removeAttribute("data-minimap-toc");
    toc?.style.removeProperty("--minimap-shift");
    toc = null;
  };
  const placeToc = (parent: HTMLElement, on: boolean) => {
    const found = on ? parent.querySelector<HTMLElement>("[data-thread-toc]") : null;
    if (found !== toc) freeToc();
    if (!found) return;
    toc = found;
    toc.dataset.minimapToc = options.hideToc ? "hide" : "left";
    toc.style.setProperty("--minimap-shift", `${width}px`);
  };

  /** What the options change on the strip itself; the rest is read by the next pass. */
  const applyOptions = () => {
    if (!host) return;
    for (const kind of KINDS) probes[kind]?.style.setProperty("color", options.colors[kind]);
    colors = null;
    host.style.setProperty("--minimap-opacity", String(options.opacity));
    host.style.setProperty("--minimap-idle", String(options.idleOpacity));
    if (options.fadeIdle) host.dataset.fade = "";
    else delete host.dataset.fade;
    host.style.setProperty("--minimap-slider-color", options.sliderColor || "var(--foreground)");
    host.style.setProperty("--minimap-slider-strength", `${Math.round(options.sliderOpacity * 100)}%`);
    host.style.setProperty("--minimap-slider-thickness", `${options.sliderThickness}px`);
    host.style.setProperty("--minimap-slider-radius", options.sliderRound ? "3px" : "0");
    if (options.showOutline) delete host.dataset.flat;
    else host.dataset.flat = "";
  };

  /** ---- one pass: read the page, lay the rectangles out, draw ---- */

  let passTimer = 0;
  let lastPass = 0;
  /** Asks for a pass; an `urgent` one (an option moved) does not wait out the pause between passes, so a dragged control is followed. */
  const request = (urgent = false) => {
    if (disposed) return;
    if (passTimer !== 0) {
      if (!urgent) return;
      window.clearTimeout(passTimer);
    }
    passTimer = window.setTimeout(() => {
      passTimer = 0;
      requestAnimationFrame(pass);
    }, urgent ? 0 : Math.max(0, lastPass + PASS_EVERY_MS - performance.now()));
  };

  const pass = () => {
    lastPass = performance.now();
    attach();
    const t = timeline;
    if (!t || !host || !canvas || !view || disposed) return;
    const { scroller, items, frame } = t;
    const parent = scroller.parentElement!;
    const itemsRect = items.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    // Heights follow the column's width; a change of window width makes what was measured wrong.
    if (Math.abs(itemsRect.width - columnWidth) > 2) {
      columnWidth = itemsRect.width;
      cache.clear();
    }
    const hasToc = parent.querySelector("[data-thread-toc]") !== null;
    width = options.width;
    // The strip hugs the right edge like a scrollbar; a kept thread-index button sits just left of it.
    const right = options.hideScrollbar ? 0 : BAR_ROOM;
    const room = options.width + (hasToc && !options.hideToc ? TOC_ROOM : 0);
    const gap = scroller.clientWidth - right - room - (itemsRect.right - scrollerRect.left);
    let fits = gap >= MIN_GAP;
    // Too narrow for the full strip: the narrow one stays, over the edge of the column if it must, when asked to.
    if (!fits && options.keepNarrow) {
      fits = true;
      width = options.narrowWidth;
    }
    if (fits && options.hideWhenFits && scroller.scrollHeight <= scroller.clientHeight + 1) fits = false;
    if (drawn.hostW !== width) {
      drawn.hostW = width;
      host.style.width = `${width}px`;
    }
    if (fits !== shown) {
      shown = fits;
      shownCallback?.(fits);
      if (fits) delete host.dataset.off;
      else host.dataset.off = "";
    }
    const hide = fits && options.hideScrollbar;
    if (hide !== barHidden) {
      barHidden = hide;
      if (hide) scroller.style.setProperty("scrollbar-width", "none");
      else scroller.style.removeProperty("scrollbar-width");
    }
    // BB shows the scrollbar only while scrolling (it sets its colour to transparent between); a colour set on the element wins over that.
    const keep = fits && !options.hideScrollbar && options.keepScrollbar;
    if (keep !== barKept) {
      barKept = keep;
      if (keep) scroller.style.setProperty("scrollbar-color", "color-mix(in oklab, var(--foreground) 40%, transparent) transparent");
      else scroller.style.removeProperty("scrollbar-color");
    }
    placeToc(parent, fits);
    if (!fits) return;

    // Where the strip sits: the scroller's own box, at the right edge, clear of the slider.
    // The track starts and ends below and above the scrollbar's arrow buttons, which are as tall as the bar is wide.
    const inset = options.hideScrollbar ? 0 : Math.max(BAR_INSET, scroller.offsetWidth - scroller.clientWidth);
    const height = Math.max(0, scroller.clientHeight - inset * 2);
    const top = scroller.offsetTop + inset;
    if (drawn.top !== top || drawn.right !== right || drawn.height !== height) {
      Object.assign(drawn, { top, right, height });
      host.style.top = `${top}px`;
      host.style.height = `${height}px`;
      host.style.right = `${right}px`;
    }

    const frameTop = frame.getBoundingClientRect().top;
    const mounted: Mounted[] = [];
    for (const row of mountedRows(items)) {
      const rect = row.getBoundingClientRect();
      if (rect.height < 1) continue;
      const id = row.dataset.timelineRowId!;
      const rank = rows?.rank.get(dataIdOf(id)) ?? null;
      const item = rank === null ? undefined : rows!.items[rank];
      const kind = item?.kind ?? kindOfDomId(id);
      const w = kind === "user" ? bubbleShare(row) : 1;
      mounted.push({ id, kind, rank, y: rect.top - frameTop, h: rect.height, w });
      // A folded row stands for several data rows, so only a row of its own is remembered.
      if (rank !== null && !id.includes(":work-summary:")) cache.set(id, { h: rect.height, w });
    }
    for (const [id, measure] of foldedHeights(rows?.items ?? [], mounted)) cache.set(id, measure);
    const aboveRows = leadOf(mounted);
    layout = inScrollerPixels(buildLayout({ items: rows?.items ?? [], mounted, cache, total: frame.offsetHeight, lead: aboveRows }));
    // BB has loaded older rows than the strip has read: ask for them, and stop once they are held.
    const need = aboveRows > LEAD_SLACK && !!rows?.hasOlder;
    if (need !== needed) {
      needed = need;
      needCallback?.(need);
    }
    stripH = height;
    draw(height);
    place();
    if (debug) Object.assign(window, { __minimap: { layout, scale, passes: ++passes, rows: rows?.items.length ?? 0, hasOlder: rows?.hasOlder, lead } });
  };

  /** ---- drawing ---- */

  const inks = (): Record<Kind, string> => {
    if (colors) return colors;
    const out = {} as Record<Kind, string>;
    for (const kind of KINDS) out[kind] = probes[kind] ? getComputedStyle(probes[kind]!).color : "#888";
    return (colors = out);
  };

  const draw = (height: number) => {
    if (!canvas) return;
    scale = scaleFor(layout.total, height);
    const dpr = window.devicePixelRatio || 1;
    painter.draw(canvas, boxesOf(layout, scale, width, height, options.show, dpr), width, height, inks);
  };

  /** Puts the slider where the scroller is. The only thing that runs as the page scrolls. */
  const place = () => {
    if (!timeline || !view) return;
    const { scroller } = timeline;
    // The scroller's pixels are converted to the strip's own, which hold still while BB re-measures.
    const from = ownOf(layout, scroller.scrollTop) * scale;
    // The rows on screen are measured, so the viewport is as tall in the strip's pixels as in the scroller's.
    const h = Math.min(stripH, Math.max(10, scroller.clientHeight * scale));
    const y = Math.min(from, Math.max(0, stripH - h));
    view.style.height = `${h}px`;
    view.style.translate = `0 ${y}px`;
  };

  let frameId = 0;
  let idleTimer = 0;
  function onScroll() {
    if (frameId === 0) {
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        place();
      });
    }
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(request, SCROLL_IDLE_MS);
  }

  const tip = createTip({
    host: () => host,
    rows: () => rows,
    layout: () => layout,
    scale: () => scale,
    enabled: () => options.hoverPreview,
    box: (index) => (options.show[layout.kinds[index]!] ? boxAt(layout, index, scale, width, window.devicePixelRatio || 1) : null),
    ink: (kind) => inks()[kind],
  });
  const steering = createSteering({
    timeline: () => timeline,
    host: () => host,
    view: () => view,
    layout: () => layout,
    scale: () => scale,
    request: () => request(),
  });

  /** ---- life ---- */

  // BB's rows move under the strip without the thread changing: a theme change recolours it.
  const recolour = () => {
    colors = null;
    request();
  };
  const theme = new MutationObserver(recolour);
  theme.observe(document.documentElement, { attributes: true });
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", recolour);

  // The scroller can be rebuilt under a thread (a layout change); a cheap check finds the new one.
  const watch = window.setInterval(() => {
    if (!timeline || !timeline.scroller.isConnected || !timeline.items.isConnected) request();
  }, 1000);
  request();

  return {
    onNeed(callback) {
      needCallback = callback;
    },
    onShown(callback) {
      shownCallback = callback;
    },
    setRows(next) {
      rows = next;
      request();
    },
    setOptions(next) {
      options = next;
      applyOptions();
      request(true);
    },
    dispose() {
      remember(threadId, { columnWidth, cache });
      disposed = true;
      steering.cancel();
      window.clearInterval(watch);
      window.clearTimeout(passTimer);
      window.clearTimeout(idleTimer);
      cancelAnimationFrame(frameId);
      painter.stop();
      theme.disconnect();
      dark.removeEventListener("change", recolour);
      detach();
    },
  };
}
