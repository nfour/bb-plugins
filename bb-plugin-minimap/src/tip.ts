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
}

/**
 * A note beside the strip saying what the rectangle under the pointer is. Nothing runs unless the pointer is
 * on the strip: its move is read once a frame, and the note takes no pointer events of its own.
 */
export function createTip(env: TipEnv): { attach(host: HTMLElement): void; detach(): void } {
  let note: HTMLDivElement | null = null;
  let at: HTMLElement | null = null;
  let frame = 0;
  let y = 0;
  let lastIndex = -2;

  const hide = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastIndex = -2;
    if (note) delete note.dataset.on;
  };

  const show = () => {
    frame = 0;
    const host = env.host();
    if (!host || !note || !env.enabled() || "drag" in host.dataset) return hide();
    const scale = env.scale();
    const layout = env.layout();
    if (scale <= 0 || layout.y.length === 0) return hide();
    const index = rectAt(layout, y / scale);
    if (index !== lastIndex) {
      lastIndex = index;
      note.textContent = tipFor(env.rows(), layout, index);
    }
    note.style.translate = `0 ${Math.max(0, y - note.offsetHeight / 2)}px`;
    note.dataset.on = "";
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
      note = document.createElement("div");
      note.className = "minimap-tip";
      note.setAttribute("aria-hidden", "true");
      host.append(note);
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
      note = at = null;
    },
  };
}
