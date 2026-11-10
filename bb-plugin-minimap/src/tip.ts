import type { Box } from "./boxes.ts";
import { rectAt, type Kind, type Layout } from "./model.ts";
import type { Rows } from "./timeline.ts";

const LABEL: Record<Kind, string> = { user: "You", reply: "Agent", work: "Work", error: "Error", system: "Note" };

/** The note for the row at `index`: its kind, and the start of its message where it has one. */
export function tipFor(rows: Rows | null, layout: Layout, index: number): string {
  if (index < 0) return "";
  const id = layout.ids[index]!;
  const rank = rows?.rank.get(id);
  const item = rank === undefined ? undefined : rows!.items[rank];
  const label = LABEL[layout.kinds[index]!];
  return item?.tip ? `${label}: ${item.tip}` : label;
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

/** A rectangle taller than this keeps the note at the pointer instead of at its middle. */
const TALL = 60;
const EDGE = 10;

/**
 * A note beside the strip saying what the rectangle under the pointer is, and an inset line round
 * that rectangle. Both are one element each, reused: moving between rows slides them, never remakes
 * them. Nothing runs unless the pointer is on the strip: its move is read once a frame, and neither
 * element takes the pointer.
 */
export function createTip(env: TipEnv): { attach(host: HTMLElement): void; detach(): void } {
  let note: HTMLDivElement | null = null;
  let text: HTMLSpanElement | null = null;
  let arrow: HTMLSpanElement | null = null;
  let mark: HTMLDivElement | null = null;
  let at: HTMLElement | null = null;
  let frame = 0;
  let snap = 0;
  let y = 0;
  let lastIndex = -2;

  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastIndex = -2;
    if (note) delete note.dataset.on;
    if (mark) delete mark.dataset.on;
  };

  const show = () => {
    frame = 0;
    const host = env.host();
    if (!host || !note || !text || !arrow || !mark || !env.enabled() || "drag" in host.dataset) return hide();
    const scale = env.scale();
    const layout = env.layout();
    if (scale <= 0 || layout.y.length === 0) return hide();
    // Between two rectangles the pointer is still on the one above: the note never goes out in a gap.
    const index = rectAt(layout, y / scale);
    const box = index < 0 ? null : env.box(index);
    if (!box) return hide();
    // The first frame after it appears puts both in place without sliding from where they were.
    const fresh = !("on" in note.dataset);
    if (fresh) {
      note.dataset.snap = mark.dataset.snap = "";
      window.clearTimeout(snap);
    }
    if (index !== lastIndex) {
      lastIndex = index;
      text.textContent = tipFor(env.rows(), layout, index);
      note.style.width = `${text.offsetWidth}px`;
      mark.style.setProperty("--minimap-hot", env.ink(box.kind));
      const h = Math.max(box.h, 4);
      mark.style.width = `${box.w}px`;
      mark.style.height = `${h}px`;
      mark.style.translate = `${box.x}px ${box.y + box.h / 2 - h / 2}px`;
    }
    const middle = box.h > TALL ? Math.min(Math.max(y, box.y + EDGE), box.y + box.h - EDGE) : box.y + box.h / 2;
    const height = note.offsetHeight;
    const top = Math.min(Math.max(0, middle - height / 2), Math.max(0, host.clientHeight - height));
    note.style.translate = `0 ${top}px`;
    arrow.style.translate = `0 ${Math.min(Math.max(middle - top, EDGE), height - EDGE)}px`;
    note.dataset.on = mark.dataset.on = "";
    if (fresh) {
      void note.offsetWidth;
      snap = window.setTimeout(() => {
        if (note) delete note.dataset.snap;
        if (mark) delete mark.dataset.snap;
      }, 30);
    }
  };

  const onMove = (event: PointerEvent) => {
    const host = env.host();
    if (!host || !env.enabled()) return;
    y = event.clientY - host.getBoundingClientRect().top;
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
      note.append(text, arrow);
      for (const el of [mark, note]) el.setAttribute("aria-hidden", "true");
      host.append(mark, note);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerleave", hide);
      host.addEventListener("pointerdown", hide);
    },
    detach() {
      hide();
      window.clearTimeout(snap);
      at?.removeEventListener("pointermove", onMove);
      at?.removeEventListener("pointerleave", hide);
      at?.removeEventListener("pointerdown", hide);
      note?.remove();
      mark?.remove();
      note = text = arrow = mark = at = null;
    },
  };
}
