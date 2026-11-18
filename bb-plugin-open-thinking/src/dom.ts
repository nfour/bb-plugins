/**
 * The only file that knows BB's markup (bb-app 0.49, undocumented): a timeline scroller
 * `[data-page-scroll-viewport]` holds rows `[data-timeline-row-id]`; a thinking row's id is
 * `<thread>:op:reasoning:…|turn:<turn>|…`; its own `button[aria-expanded]` toggles it; a finished
 * turn is one `…:turn:<n>` row; the live "Thinking…" line is a toggle after the row list, outside
 * every row. A rename here makes the plugin do nothing; it cannot click anything that is not a
 * thinking toggle.
 */
import { isThinkingId, isTurnRowId, LIVE_KEY, threadOf, turnOf, type Entry } from "./model.ts";

const ROW = "data-timeline-row-id";
const SCROLLER = "[data-page-scroll-viewport]";
const TOGGLE = "button[aria-expanded]";
const ROW_LIST = "[data-timeline-row-list]";
/** What an added node may hold that is worth a look: rows (their children too), a scroller, a toggle (the live line). */
export const WATCHED = `[${ROW}],${SCROLLER},${TOGGLE}`;
/** The live line's title. */
const LIVE_TITLE = "Thinking";

export interface Pane {
  scroller: Element;
  /** The thread whose rows the scroller holds, read off its first row. */
  thread: string | null;
  entries: Entry[];
  /** Each entry's toggle, by key. */
  toggles: Map<string, HTMLElement>;
}

/** Each timeline on the page: one, or one per pane of a split workspace. */
export function scrollers(): Element[] {
  return [...document.querySelectorAll(SCROLLER)];
}

/** The row's own toggle, not one of a nested row. */
function ownToggle(row: Element): HTMLElement | null {
  for (const toggle of row.querySelectorAll<HTMLElement>(TOGGLE)) if (toggle.closest(`[${ROW}]`) === row) return toggle;
  return null;
}

function insideTurnRow(row: Element): boolean {
  for (let up = row.parentElement; up; up = up.parentElement) {
    const id = up.getAttribute(ROW);
    if (id && isTurnRowId(id)) return true;
  }
  return false;
}

function isLiveLine(toggle: Element): boolean {
  return !toggle.closest(`[${ROW}]`) && !toggle.closest(ROW_LIST) && (toggle.textContent ?? "").trim().startsWith(LIVE_TITLE);
}

/** What one timeline shows of thinking: every thinking row in page order, then the live line if it is open for clicking. */
export function readPane(scroller: Element): Pane {
  const first = scroller.querySelector(`[${ROW}]`)?.getAttribute(ROW);
  const entries: Entry[] = [];
  const toggles = new Map<string, HTMLElement>();
  for (const row of scroller.querySelectorAll(`[${ROW}*=":op:reasoning:"]`)) {
    const id = row.getAttribute(ROW);
    if (!id || !isThinkingId(id)) continue;
    const toggle = ownToggle(row);
    if (!toggle) continue;
    entries.push({ key: id, open: toggle.getAttribute("aria-expanded") === "true", live: false, folded: insideTurnRow(row), turn: turnOf(id) });
    toggles.set(id, toggle);
  }
  for (const toggle of scroller.querySelectorAll<HTMLElement>(TOGGLE)) {
    if (!isLiveLine(toggle)) continue;
    entries.push({ key: LIVE_KEY, open: toggle.getAttribute("aria-expanded") === "true", live: true, folded: false, turn: null });
    toggles.set(LIVE_KEY, toggle);
    break;
  }
  return { scroller, thread: first ? threadOf(first) : null, entries, toggles };
}

/** Whether an added node is, or holds, anything `readPane` could find. */
export function mayHoldThinking(node: Node): boolean {
  return node instanceof Element && (node.matches(WATCHED) || node.querySelector(WATCHED) !== null);
}

/** What a click landed on, when it was a thinking toggle. */
export type Clicked = { live: false; thread: string; key: string; scroller: Element | null } | { live: true; scroller: Element | null };

export function thinkingToggleAt(target: EventTarget | null): Clicked | null {
  if (!(target instanceof Element)) return null;
  const toggle = target.closest(TOGGLE);
  if (!toggle) return null;
  const scroller = toggle.closest(SCROLLER);
  const row = toggle.closest(`[${ROW}]`);
  if (!row) return isLiveLine(toggle) ? { live: true, scroller } : null;
  const key = row.getAttribute(ROW);
  const thread = key ? threadOf(key) : null;
  if (!key || !thread || !isThinkingId(key) || ownToggle(row) !== toggle) return null;
  return { live: false, thread, key, scroller };
}

/** Row ids that have their own toggle and enclose `row`, outermost first; a finished turn's row is left out, it is not work in progress. */
export function chainOf(row: Element): string[] {
  const ids: string[] = [];
  for (let up = row.parentElement; up; up = up.parentElement) {
    const id = up.getAttribute(ROW);
    if (id && !isTurnRowId(id) && ownToggle(up)) ids.unshift(id);
  }
  return ids;
}

function rowById(scroller: Element, id: string): Element | null {
  return scroller.querySelector(`[${ROW}="${id}"]`);
}

/** The thinking row with this id, on the page now. */
export function thinkingRow(scroller: Element, key: string): Element | null {
  return rowById(scroller, key);
}

/** The id of the group on the page that opens with this thought (a group's id ends with its first child's). */
export function groupLedBy(scroller: Element, key: string): string | null {
  return scroller.querySelector(`[${ROW}$=":work-summary:${key}"]`)?.getAttribute(ROW) ?? null;
}

/** A row's own toggle and whether it is open, when the row is on the page. */
export function rowToggle(scroller: Element, id: string): { toggle: HTMLElement; open: boolean } | null {
  const row = rowById(scroller, id);
  const toggle = row ? ownToggle(row) : null;
  return toggle ? { toggle, open: toggle.getAttribute("aria-expanded") === "true" } : null;
}

/** What a click landed on, when it was any row's toggle. */
export function rowToggleAt(target: EventTarget | null): { thread: string; key: string } | null {
  if (!(target instanceof Element)) return null;
  const toggle = target.closest(TOGGLE);
  const row = toggle?.closest(`[${ROW}]`);
  const key = row?.getAttribute(ROW);
  const thread = key ? threadOf(key) : null;
  return row && toggle && key && thread && ownToggle(row) === toggle ? { thread, key } : null;
}

/** The box that holds the live line's text and scrolls when the text outgrows it. */
export function liveScrollBox(toggle: Element): HTMLElement | null {
  const frame = toggle.parentElement?.parentElement;
  if (!frame) return null;
  for (const el of frame.querySelectorAll<HTMLElement>("*")) {
    if (el === toggle || toggle.contains(el)) continue;
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el;
  }
  return null;
}
