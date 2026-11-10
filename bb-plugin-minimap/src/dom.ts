/** BB's timeline DOM, as found in bb-app 0.49. Undocumented: see AGENTS.md. */
export interface Timeline {
  scroller: HTMLElement;
  /** `[data-timeline-items]`: the mounted rows and the windowing spacers. */
  items: HTMLElement;
  /** The scroller's one child: a box as tall as the content. */
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

/** A user message's width as a share of the message column: its bubble hugs its text. */
export function bubbleShare(row: HTMLElement): number {
  const column = row.querySelector<HTMLElement>("[data-message-column]");
  const bubble = column?.firstElementChild;
  if (!column || !(bubble instanceof HTMLElement)) return 1;
  const full = column.getBoundingClientRect().width;
  return full > 0 ? Math.min(1, bubble.getBoundingClientRect().width / full) : 1;
}
