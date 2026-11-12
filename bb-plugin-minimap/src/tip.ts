import type { Box } from "./boxes.ts";
import { ICONS, KIND_ICON } from "./icons.ts";
import { KINDS, rectAt, type Kind, type Layout } from "./model.ts";
import type { Rows } from "./timeline.ts";
import { isJump, planLines, windowStart } from "./window.ts";

const LABEL: Record<Kind, string> = { user: "You", reply: "Agent", work: "Work", error: "Error", system: "Note" };

/** What the note shows for the row at `index`: an icon by what it is, and the start of its text, or its name where it has no text. */
export function tipOf(rows: Rows | null, layout: Layout, index: number, lines = 1): { icon: string; text: string } | null {
  if (index < 0) return null;
  const kind = layout.kinds[index]!;
  const rank = rows?.rank.get(layout.ids[index]!);
  const item = rank === undefined ? undefined : rows!.items[rank];
  return { icon: item?.icon ?? KIND_ICON[kind], text: (lines > 1 && item?.more) || item?.tip || item?.label || LABEL[kind] };
}

export interface TipEnv {
  host(): HTMLElement | null;
  rows(): Rows | null;
  layout(): Layout;
  scale(): number;
  enabled(): boolean;
  /** The rectangle drawn for a row, or null when its kind is not shown. */
  box(index: number): Box | null;
  /** Whether rectangles of a kind are drawn. */
  shown(kind: Kind): boolean;
  /** The colour a kind is painted in. */
  ink(kind: Kind): string;
  /** How the note looks and moves; read each frame, so a change applies at once. */
  config(): TipConfig;
}

export interface TipConfig {
  /** Rows shown above and below the pointer's, 0 to 6. */
  context: number;
  /** Lines of text each row shows, 1 to 6. */
  lines: number;
  /** False swaps at once, whatever `slideMs` is. */
  animate: boolean;
  /** How long a glide takes in ms; 0 swaps at once. */
  slideMs: number;
  /** Softening in px at the start of a glide past many rows; 0 is none. */
  soft: number;
  /** The note takes a new row at most this often, in ms. */
  delay: number;
}

/** The height of a line of text, and the padding above and below a row; a row's slot is its text lines' height plus both, so the rows next to the one shown are fully outside the window. */
const LINE_H = 17;
const PAD = 5;
/** The softening reaches its peak after the glide has passed this many rows. */
const SOFT_ROWS = 8;
/** How close the note may come to the top or bottom of the strip. */
const EDGE = 10;
/** Space between the note and the strip. */
const GAP = 12;

/** The rows the strip draws, as indices into the layout in order: the note walks these, so a kind switched off never takes a place in it. */
export function drawnRows(layout: Layout, shown: (kind: Kind) => boolean): number[] {
  const out: number[] = [];
  for (let index = 0; index < layout.kinds.length; index++) if (shown(layout.kinds[index]!)) out.push(index);
  return out;
}

/** The place in `drawn` of the first row at or after `index`, or `drawn.length` when there is none. */
export function firstAtOrAfter(drawn: readonly number[], index: number): number {
  let lo = 0;
  let hi = drawn.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (drawn[mid]! < index) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A note beside the strip saying what the rectangle nearest the pointer is, and an inset line round
 * that rectangle. Both are one element each, reused. The note follows the pointer's height itself, so
 * it moves as smoothly as the pointer; only which rectangle it names (and the line) changes in steps,
 * at most every `config().delay`. Nothing runs unless the pointer is on the strip: its move is read once a
 * frame, and neither element takes the pointer. A pass of the strip (`refresh`) re-reads what it names, since
 * the rows under a resting pointer can change; the strip hiding takes the note away.
 *
 * Places are counted among the drawn rows (`drawn`), and what is shown is tracked by row id, so a row that
 * moves in the layout (older history loading above it, a turn folding) is not taken for another.
 */
export function createTip(env: TipEnv): { attach(host: HTMLElement): void; detach(): void; refresh(): void; hide(): void } {
  let note: HTMLDivElement | null = null;
  let arrow: HTMLSpanElement | null = null;
  let list: HTMLDivElement | null = null;
  /** The lines built, by place among the drawn rows. */
  const lines = new Map<number, HTMLDivElement>();
  let drawn: number[] = [];
  let drawnFor: Layout | null = null;
  let drawnKey = "";
  /** The window's first place, the id and place of the row shown, the sizes the window was built for. */
  let pos = NaN;
  let shownId = "";
  let shownPlace = -1;
  let shownKey = "";
  let slot = 0;
  let textLines = 1;
  let hotLine: HTMLElement | null = null;
  let blurring: Animation | null = null;
  let markKey = "";
  let reduced: MediaQueryList | null = null;
  let mark: HTMLDivElement | null = null;
  let at: HTMLElement | null = null;
  let frame = 0;
  let y = 0;
  let pointerY = 0;
  let height = 0;
  let room = 0;
  let hostLeft = NaN;
  let changedAt = -Infinity;
  let wait = 0;

  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    shownId = "";
    shownPlace = -1;
    changedAt = -Infinity;
    window.clearTimeout(wait);
    wait = 0;
    blurring?.cancel();
    blurring = null;
    if (note) delete note.dataset.on;
    if (mark) delete mark.dataset.on;
  };

  /** Puts the icon, text and id of the row at `place` into `line`, touching only what differs. */
  const fill = (line: HTMLDivElement, place: number, layout: Layout) => {
    const index = drawn[place]!;
    const tip = tipOf(env.rows(), layout, index, textLines);
    const text = tip?.text ?? "";
    const icon = tip?.icon ?? "";
    line.dataset.id = layout.ids[index] ?? "";
    // The icon wears the colour of its row's kind, as drawn on the strip (the user's own where they chose one).
    const tone = env.ink(layout.kinds[index]!);
    const glyph = line.firstElementChild as SVGElement | null;
    if (glyph && glyph.style.color !== tone) glyph.style.color = tone;
    line.style.translate = `0 ${place * slot}px`;
    if (line.dataset.icon !== icon) {
      line.dataset.icon = icon;
      line.querySelector("path")!.setAttribute("d", ICONS[icon] ?? "");
    }
    if (line.dataset.text !== text) {
      line.dataset.text = text;
      line.querySelector("span")!.textContent = text;
    }
  };

  /** One line of the list, in its own slot. */
  const lineFor = (place: number, layout: Layout): HTMLDivElement => {
    const line = document.createElement("div");
    line.className = "minimap-tip-line";
    line.style.height = `${slot}px`;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", "minimap-tip-icon");
    svg.append(document.createElementNS("http://www.w3.org/2000/svg", "path"));
    const label = document.createElement("span");
    label.className = "minimap-tip-text";
    line.append(svg, label);
    fill(line, place, layout);
    return line;
  };

  /** Builds only the lines a glide from `from` to `to` passes, brings them up to date, keeps the ones near it and drops the rest. */
  const keepLines = (layout: Layout, from: number, to: number, span: number) => {
    const plan = planLines(lines.keys(), from, to, span, drawn.length);
    for (const place of plan.drop) {
      lines.get(place)?.remove();
      lines.delete(place);
    }
    for (const place of plan.refresh) fill(lines.get(place)!, place, layout);
    for (const place of plan.build) {
      const line = lineFor(place, layout);
      lines.set(place, line);
      list!.append(line);
    }
  };

  /** The drawn rectangle nearest the pointer: the row under it, or the drawn one next to it, whichever is closer. */
  const nearest = (layout: Layout, at: number): { place: number; box: Box } | null => {
    if (drawn.length === 0) return null;
    const under = Math.min(Math.max(0, rectAt(layout, at / env.scale())), layout.y.length - 1);
    const after = firstAtOrAfter(drawn, under);
    let best: { place: number; box: Box } | null = null;
    let gap = Infinity;
    for (const place of [after - 1, after]) {
      if (place < 0 || place >= drawn.length) continue;
      const box = env.box(drawn[place]!);
      if (!box) continue;
      const away = at < box.y ? box.y - at : at > box.y + box.h ? at - box.y - box.h : 0;
      if (away < gap) {
        gap = away;
        best = { place, box };
      }
    }
    return best;
  };

  const show = () => {
    frame = 0;
    const host = env.host();
    if (!host || !note || !list || !arrow || !mark || !env.enabled() || "off" in host.dataset) return hide();
    const layout = env.layout();
    if (env.scale() <= 0 || layout.y.length === 0) return hide();
    // The rows the strip draws, worked out again only when the layout or the kinds shown change.
    const key = KINDS.map((kind) => (env.shown(kind) ? 1 : 0)).join("");
    if (layout !== drawnFor || key !== drawnKey) {
      drawnFor = layout;
      drawnKey = key;
      drawn = drawnRows(layout, env.shown);
    }
    // The one layout read of the frame comes first, before anything is written.
    const rect = host.getBoundingClientRect();
    y = pointerY - rect.top;
    room = host.clientHeight;
    if (height === 0) height = note.offsetHeight;
    const near = nearest(layout, y);
    if (!near) return hide();
    const config = env.config();
    const context = Math.min(6, Math.max(0, Math.round(config.context)));
    textLines = Math.min(6, Math.max(1, Math.round(config.lines)));
    const span = 2 * context + 1;
    let fresh = !("on" in note.dataset);
    if (`${context}:${textLines}` !== shownKey) {
      // The window's size changed: it is measured again, and the list starts over.
      shownKey = `${context}:${textLines}`;
      slot = textLines * LINE_H + 2 * PAD;
      list.parentElement!.style.height = `${span * slot}px`;
      note.style.setProperty("--minimap-clamp", String(textLines));
      if (span > 1) note.dataset.many = "";
      else delete note.dataset.many;
      height = note.offsetHeight;
      shownId = "";
      fresh = true;
    }
    const id = layout.ids[drawn[near.place]!]!;
    // The row shown has moved in the layout (older history loaded above it, a turn folded): the lines hold other rows now.
    const moved = shownId !== "" && layout.ids[drawn[shownPlace] ?? -1] !== shownId;
    if (moved) {
      fresh = true;
      shownId = "";
    }
    if (id !== shownId) {
      // Too soon after the last change: keep what is shown and take the pointer's row once the interval is up.
      const since = performance.now() - changedAt;
      if (!fresh && since < config.delay) {
        if (wait === 0) {
          wait = window.setTimeout(() => {
            wait = 0;
            if (frame === 0) frame = requestAnimationFrame(show);
          }, config.delay - since);
        }
      } else {
        changedAt = performance.now();
        // The list holds a line for every row the glide passes, at its place; the window shows `span` of them
        // with the pointer's row in the middle, moved inward at either end of the thread so no part of it is empty.
        const start = windowStart(near.place, context, drawn.length);
        const jump = fresh || config.slideMs <= 0 || !!reduced?.matches || isJump(start, pos, config.animate);
        if (jump) {
          for (const line of lines.values()) line.remove();
          lines.clear();
          hotLine = null;
        }
        keepLines(layout, jump ? start : pos, start, span);
        // Spelled from parts: each of these words alone would become a page-wide rule in the build.
        blurring?.cancel();
        blurring = null;
        const passed = jump ? 0 : Math.abs(start - pos);
        if (passed > 1 && config.soft > 0) {
          const lens = (px: number) => `${["bl", "ur"].join("")}(${px}px)`;
          const prop = ["fil", "ter"].join("");
          const peak = Math.min(config.soft, ((passed - 1) * config.soft) / SOFT_ROWS);
          // It starts at its peak and follows the glide's own curve down, so the list is softest while it moves fastest
          // (the glide starts quickly and settles slowly); a peak in the middle came in after most of the distance was covered.
          blurring = list.animate([{ [prop]: lens(peak) }, { [prop]: lens(0) }], { duration: config.slideMs, easing: "cubic-bezier(0, 0, 0.2, 1)" });
        }
        list.style.setProperty(["transi", "tion"].join(""), jump ? "none" : `translate ${config.slideMs}ms cubic-bezier(0, 0, 0.2, 1)`);
        list.style.translate = `0 ${-start * slot}px`;
        pos = start;
        shownId = id;
        shownPlace = near.place;
        // With several lines shown, the pointer's own is the bright one.
        if (hotLine) delete hotLine.dataset.hot;
        hotLine = lines.get(near.place) ?? null;
        if (hotLine) hotLine.dataset.hot = "";
      }
    } else {
      // The same row: its text can still have changed (a reply streaming), so its line is brought up to date.
      // Its context lines too: they are other rows, and a pass or a stream can change them as well.
      const from = Math.max(0, pos);
      for (let place = from; place < Math.min(drawn.length, from + span); place++) {
        const line = lines.get(place);
        if (line) fill(line, place, layout);
      }
      shownPlace = near.place;
    }
    // The line round the rectangle follows the one it names, which a pass can move or change in size under a resting pointer.
    const named = layout.ids[drawn[shownPlace] ?? -1] === shownId ? env.box(drawn[shownPlace]!) : null;
    const box = named ?? near.box;
    const h = Math.max(box.h, 4);
    const nextMark = `${box.x}|${box.y}|${box.w}|${h}|${box.kind}`;
    if (nextMark !== markKey) {
      markKey = nextMark;
      mark.style.setProperty("--minimap-hot", env.ink(box.kind));
      mark.style.width = `${box.w}px`;
      mark.style.height = `${h}px`;
      mark.style.translate = `${box.x}px ${box.y + box.h / 2 - h / 2}px`;
    }
    // The note is at the pointer, whatever it names.
    const top = Math.min(Math.max(0, y - height / 2), Math.max(0, room - height));
    note.style.translate = `0 ${rect.top + top}px`;
    if (rect.left !== hostLeft) {
      hostLeft = rect.left;
      note.style.right = `${document.documentElement.clientWidth - rect.left + GAP}px`;
    }
    arrow.style.translate = `0 ${Math.min(Math.max(y - top, EDGE), height - EDGE)}px`;
    if (!("on" in note.dataset)) note.dataset.on = mark.dataset.on = "";
  };

  const onMove = (event: PointerEvent) => {
    const host = env.host();
    if (!host || !env.enabled()) return;
    pointerY = event.clientY;
    if (frame === 0) frame = requestAnimationFrame(show);
  };

  return {
    attach(host) {
      at = host;
      reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
      mark = document.createElement("div");
      mark.className = "minimap-hot";
      note = document.createElement("div");
      note.className = "minimap-tip";
      arrow = document.createElement("span");
      arrow.className = "minimap-tip-arrow";
      const clip = document.createElement("div");
      clip.className = "minimap-tip-clip";
      list = document.createElement("div");
      list.className = "minimap-tip-list";
      clip.append(list);
      note.append(clip, arrow);
      for (const el of [mark, note]) el.setAttribute("aria-hidden", "true");
      // The note lives on the page's body, not in the thread: a change of its text inside the thread's
      // subtree made the browser lay out far more than the note (about 50ms a change), outside it is cheap.
      note.style.setProperty("--minimap-pos", ["abs", "olute"].join(""));
      note.style.position = ["fi", "xed"].join("");
      host.append(mark);
      document.body.append(note);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", hide);
    },
    refresh() {
      if (note && "on" in note.dataset && frame === 0) frame = requestAnimationFrame(show);
    },
    hide,
    detach() {
      hide();
      at?.removeEventListener("pointermove", onMove);
      at?.removeEventListener("pointerleave", hide);
      note?.remove();
      mark?.remove();
      hostLeft = NaN;
      lines.clear();
      drawn = [];
      drawnFor = null;
      drawnKey = "";
      pos = NaN;
      shownKey = "";
      markKey = "";
      hotLine = null;
      reduced = null;
      note = arrow = list = mark = at = null;
    },
  };
}
