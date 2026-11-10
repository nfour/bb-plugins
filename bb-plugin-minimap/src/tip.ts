import type { Box } from "./boxes.ts";
import { ICONS, KIND_ICON } from "./icons.ts";
import { rectAt, type Kind, type Layout } from "./model.ts";
import type { Rows } from "./timeline.ts";

const LABEL: Record<Kind, string> = { user: "You", reply: "Agent", work: "Work", error: "Error", system: "Note" };

/** What the note shows for the row at `index`: an icon by what it is, and the start of its text, or its name where it has no text. */
export function tipOf(rows: Rows | null, layout: Layout, index: number): { icon: string; text: string } | null {
  if (index < 0) return null;
  const kind = layout.kinds[index]!;
  const rank = rows?.rank.get(layout.ids[index]!);
  const item = rank === undefined ? undefined : rows!.items[rank];
  return { icon: item?.icon ?? KIND_ICON[kind], text: item?.tip || item?.label || LABEL[kind] };
}

export interface TipEnv {
  host(): HTMLElement | null;
  rows(): Rows | null;
  layout(): Layout;
  scale(): number;
  enabled(): boolean;
  /** The rectangle drawn for a row, or null when its kind is not shown. */
  box(index: number): Box | null;
  /** The colour a kind is painted in. */
  ink(kind: Kind): string;
}

/** The note and its line round the rectangle change row at most this often; sweeping past many small rectangles lands on the one the pointer rests on. */
const SETTLE_MS = 100;
const EDGE = 10;
/** Space between the note and the strip. */
const GAP = 12;

/**
 * A note beside the strip saying what the rectangle nearest the pointer is, and an inset line round
 * that rectangle. Both are one element each, reused. The note follows the pointer's height itself, so
 * it moves as smoothly as the pointer; only which rectangle it names (and the line) changes in steps,
 * at most every `SETTLE_MS`. Nothing runs unless the pointer is on the strip: its move is read once a
 * frame, and neither element takes the pointer.
 */
export function createTip(env: TipEnv): { attach(host: HTMLElement): void; detach(): void } {
  let note: HTMLDivElement | null = null;
  let text: HTMLSpanElement | null = null;
  let arrow: HTMLSpanElement | null = null;
  let clip: HTMLDivElement | null = null;
  let glyph: SVGPathElement | null = null;
  let mark: HTMLDivElement | null = null;
  let at: HTMLElement | null = null;
  let frame = 0;
  let y = 0;
  let pointerY = 0;
  let height = 0;
  let room = 0;
  let hostLeft = NaN;
  let lastIndex = -2;
  let changedAt = -Infinity;
  let wait = 0;

  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastIndex = -2;
    changedAt = -Infinity;
    window.clearTimeout(wait);
    wait = 0;
    if (note) delete note.dataset.on;
    if (mark) delete mark.dataset.on;
  };

  /** The rectangle nearest the pointer that is drawn: the row under it, or the one below it, whichever is closer. */
  const nearest = (layout: Layout, at: number): { index: number; box: Box } | null => {
    const under = Math.max(0, rectAt(layout, at / env.scale()));
    let best: { index: number; box: Box } | null = null;
    let gap = Infinity;
    for (const index of [under, under + 1]) {
      const box = index < layout.y.length ? env.box(index) : null;
      if (!box) continue;
      const away = at < box.y ? box.y - at : at > box.y + box.h ? at - box.y - box.h : 0;
      if (away < gap) {
        gap = away;
        best = { index, box };
      }
    }
    // The rows under the pointer may be of a kind that is not shown: take the nearest drawn one above.
    for (let index = under - 1; !best && index >= 0 && index > under - 20; index--) {
      const box = env.box(index);
      if (box) best = { index, box };
    }
    return best;
  };

  const show = () => {
    frame = 0;
    const host = env.host();
    if (!host || !note || !text || !arrow || !mark || !env.enabled() || "drag" in host.dataset) return hide();
    const layout = env.layout();
    if (env.scale() <= 0 || layout.y.length === 0) return hide();
    // The one layout read of the frame comes first, before anything is written.
    const rect = host.getBoundingClientRect();
    y = pointerY - rect.top;
    room = host.clientHeight;
    if (height === 0) height = note.offsetHeight;
    const near = nearest(layout, y);
    if (!near) return hide();
    const fresh = !("on" in note.dataset);
    if (near.index !== lastIndex) {
      // Too soon after the last change: keep what is shown and take the pointer's row once the interval is up.
      const since = performance.now() - changedAt;
      if (!fresh && since < SETTLE_MS) {
        if (wait === 0) {
          wait = window.setTimeout(() => {
            wait = 0;
            if (frame === 0) frame = requestAnimationFrame(show);
          }, SETTLE_MS - since);
        }
      } else {
        changedAt = performance.now();
        lastIndex = near.index;
        const tip = tipOf(env.rows(), layout, near.index);
        text.textContent = tip?.text ?? "";
        glyph!.setAttribute("d", ICONS[tip?.icon ?? ""] ?? "");
        const box = near.box;
        mark.style.setProperty("--minimap-hot", env.ink(box.kind));
        const h = Math.max(box.h, 4);
        mark.style.width = `${box.w}px`;
        mark.style.height = `${h}px`;
        mark.style.translate = `${box.x}px ${box.y + box.h / 2 - h / 2}px`;
      }
    }
    // The note is at the pointer, whatever it names.
    const top = Math.min(Math.max(0, y - height / 2), Math.max(0, room - height));
    note.style.translate = `0 ${rect.top + top}px`;
    if (rect.left !== hostLeft) {
      hostLeft = rect.left;
      note.style.right = `${document.documentElement.clientWidth - rect.left + GAP}px`;
    }
    arrow.style.translate = `0 ${Math.min(Math.max(y - top, EDGE), height - EDGE)}px`;
    note.dataset.on = mark.dataset.on = "";
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
      mark = document.createElement("div");
      mark.className = "minimap-hot";
      note = document.createElement("div");
      note.className = "minimap-tip";
      text = document.createElement("span");
      text.className = "minimap-tip-text";
      // The word on its own would become a page-wide rule in the build.
      text.style.display = ["inli", "ne-bl", "ock"].join("");
      arrow = document.createElement("span");
      arrow.className = "minimap-tip-arrow";
      clip = document.createElement("div");
      clip.className = "minimap-tip-clip";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("class", "minimap-tip-icon");
      // BB's base style makes an svg a box of its own; the icon sits in the text's line.
      svg.style.display = ["inli", "ne"].join("");
      glyph = document.createElementNS("http://www.w3.org/2000/svg", "path");
      svg.append(glyph);
      clip.append(svg, text);
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
      host.addEventListener("pointerdown", hide);
    },
    detach() {
      hide();
      at?.removeEventListener("pointermove", onMove);
      at?.removeEventListener("pointerleave", hide);
      at?.removeEventListener("pointerdown", hide);
      note?.remove();
      mark?.remove();
      hostLeft = NaN;
      note = text = arrow = clip = glyph = mark = at = null;
    },
  };
}
