import { dataIdOf } from "./model.ts";

/** BB's timeline DOM, as found in bb-app 0.47 and rechecked on 0.50.1. Undocumented: see AGENTS.md. */
export interface Timeline {
  scroller: HTMLElement;
  /** `[data-timeline-items]`: the mounted rows and the windowing spacers. */
  items: HTMLElement;
  /** The scroller's one child: a box as tall as the content, where the bar's row sticks. */
  frame: HTMLElement;
}

/** The scroller showing `threadId`, or null while it has not mounted. */
export function findTimeline(threadId: string): Timeline | null {
  const row = document.querySelector(`[data-timeline-row-id^="${CSS.escape(threadId)}:"]`);
  const scroller = row?.closest<HTMLElement>("[data-page-scroll-viewport]");
  const items = scroller?.querySelector<HTMLElement>("[data-timeline-items]");
  const frame = scroller?.firstElementChild;
  if (!scroller || !items || !(frame instanceof HTMLElement)) return null;
  return { scroller, items, frame };
}

/** The mounted rows, top to bottom. The windowing spacers between them are skipped. */
export function mountedRows(items: HTMLElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of items.children) {
    if (child instanceof HTMLElement && child.dataset.timelineRowId !== undefined) rows.push(child);
  }
  return rows;
}

export function rowById(items: HTMLElement, id: string): HTMLElement | null {
  for (const row of mountedRows(items)) if (row.dataset.timelineRowId === id) return row;
  return null;
}

/**
 * The rank of the row a mounted row stands for, walking back to the nearest row
 * the timeline knows when it is one BB made up (and the data has no id for).
 */
export function rankOfRow(rows: readonly HTMLElement[], at: number, rank: ReadonlyMap<string, number>): number | null {
  for (let i = at; i >= 0; i--) {
    const found = rank.get(dataIdOf(rows[i]!.dataset.timelineRowId!));
    if (found !== undefined) return found;
  }
  return null;
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
