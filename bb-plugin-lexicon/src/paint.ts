// Paints the lexicon over the thread timeline with the CSS Custom Highlight API.
//
// A highlight is a set of Ranges the browser paints with `::highlight(name)`
// rules, so nothing is added to BB's DOM: React cannot fight it and a streaming
// row needs no care beyond repainting what changed. One highlight per
// (shape, hue, alias) look, its rule made on first use in one adopted stylesheet.
//
// Only rows BB has mounted are painted (the timeline is virtualized). One
// MutationObserver sits on each `[data-timeline-items]`; a change marks its row
// dirty and the dirty rows are repainted together in the next frame, so a
// streaming reply costs one pass over its own text per frame and the rest of the
// page costs nothing. The composer and everything outside the timeline are never
// observed, and nothing here runs per scroll or per keystroke.
import { findTerms, highlightName, highlightRule, type Look, type Matcher } from "./lexicon.ts";

const ITEMS = "[data-timeline-items]";
const ROW = "[data-timeline-row-id]";
/** Rows of the reader's and the agent's words; tool and turn rows carry other text. */
const WORDS_ROW = /:(assistant|user)[-:]/;
/** Where a phrase cannot run on: the nearest of these around a text node is its paragraph. */
const BREAKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, div, dd, dt, figcaption, summary, section";
/** Never painted: code blocks (their colours are the syntax theme's), controls and times. */
const SKIPPED = new Set(["PRE", "BUTTON", "TIME", "SVG", "STYLE", "SCRIPT", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"]);
/** The least time between two repaints: a streaming reply changes every frame, its colours need not. */
const REPAINT_MS = 100;
/** How often the page is checked for timelines that came or went (thread switches replace them). */
const SCAN_MS = 400;

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** One lexicon per thread: two panes on different projects each paint with their own, and a thread with none is left plain. */
const matchers = new Map<string, Matcher>();
let enabled = true;
let engine: Engine | null = null;
const listeners = new Set<(threads: readonly string[]) => void>();

/** A timeline row's thread: its id starts with the thread's. */
const threadOf = (row: Element): string => (row.getAttribute("data-timeline-row-id") ?? "").split(":", 1)[0]!;

/** The lexicon to paint `threadId`'s rows with, or null for none. */
export function setLexicon(threadId: string, next: Matcher | null): void {
  if ((matchers.get(threadId) ?? null) === next) return;
  if (next) matchers.set(threadId, next);
  else matchers.delete(threadId);
  engine?.restyle(threadId);
}

/** Calls `listener` with the threads that have a timeline on the page, now and whenever they change. Returns the way to stop. */
export function onThreads(listener: (threads: readonly string[]) => void): () => void {
  listeners.add(listener);
  if (engine) listener(engine.threads());
  return () => void listeners.delete(listener);
}

/** The `enabled` setting. */
export function setEnabled(value: boolean): void {
  if (enabled === value) return;
  enabled = value;
  engine?.restyle();
}

/** Counters for measuring, kept only when `localStorage["lexicon:debug"]` is set. */
export interface Stats {
  paints: number;
  ms: number;
  slowest: number;
  rows: number;
  /** Phrases in the lexicon, and the timelines being watched. */
  terms: number;
  roots: number;
}
declare global {
  interface Window {
    __lexiconStats?: Stats;
  }
}

/** Starts watching the page. Returns the stop function the content script hands back to BB. */
export function install(signal: AbortSignal): () => void {
  if (!supported()) return () => {};
  const instance = new Engine();
  engine = instance;
  const stop = () => {
    if (engine === instance) engine = null;
    instance.dispose();
  };
  signal.addEventListener("abort", stop, { once: true });
  return stop;
}

class Engine {
  private readonly sheet = new CSSStyleSheet();
  private readonly highlights = new Map<string, Highlight>();
  /** The ranges each row holds, to take them out again. */
  private readonly painted = new Map<Element, { highlight: Highlight; range: Range }[]>();
  private readonly roots = new Map<Element, MutationObserver>();
  private readonly dirty = new Set<Element>();
  private frame = 0;
  private wait = 0;
  private last = 0;
  /** The threads last reported to `onThreads`, joined. */
  private seen = "";
  private readonly timer: number;
  private readonly stats: Stats | null;

  constructor() {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    this.stats = localStorage.getItem("lexicon:debug") ? (window.__lexiconStats = { paints: 0, ms: 0, slowest: 0, rows: 0, terms: 0, roots: 0 }) : null;
    this.timer = window.setInterval(() => this.scan(), SCAN_MS);
    this.scan();
  }

  /** Threads with a timeline on the page, in order of appearance. */
  threads(): string[] {
    const found = new Set<string>();
    for (const root of document.querySelectorAll(ITEMS)) {
      const row = root.querySelector(ROW);
      if (row) found.add(threadOf(row));
    }
    return [...found];
  }

  /** A lexicon (one thread's, or with none given the setting) changed: paint the mounted rows again. The highlights themselves depend only on the look, so they stay. */
  restyle(threadId?: string): void {
    if (this.stats) this.stats.terms = Math.max(0, ...[...matchers.values()].map((m) => m.hits.size));
    for (const row of [...this.painted.keys()]) if (threadId === undefined || threadOf(row) === threadId) this.unpaint(row);
    this.scan();
    for (const root of this.roots.keys()) for (const row of root.querySelectorAll(ROW)) if (threadId === undefined || threadOf(row) === threadId) this.mark(row);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    cancelAnimationFrame(this.frame);
    window.clearTimeout(this.wait);
    for (const observer of this.roots.values()) observer.disconnect();
    this.roots.clear();
    this.dirty.clear();
    this.seen = "";
    for (const name of this.highlights.keys()) CSS.highlights.delete(name);
    this.highlights.clear();
    this.painted.clear();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== this.sheet);
    if (this.stats && window.__lexiconStats === this.stats) delete window.__lexiconStats;
  }

  /** Watches every timeline on the page, drops those that left it. */
  private scan(): void {
    for (const [root, observer] of this.roots) {
      if (root.isConnected) continue;
      observer.disconnect();
      this.roots.delete(root);
      this.sweep();
    }
    const threads = this.threads();
    const key = threads.join(" ");
    if (key !== this.seen) {
      this.seen = key;
      for (const listener of listeners) listener(threads);
    }
    if (!enabled) return;
    for (const root of document.querySelectorAll(ITEMS)) {
      if (this.roots.has(root)) continue;
      const observer = new MutationObserver((records) => this.observe(root, records));
      observer.observe(root, { childList: true, characterData: true, subtree: true });
      this.roots.set(root, observer);
      for (const row of root.querySelectorAll(ROW)) this.mark(row);
    }
    if (this.stats) this.stats.roots = this.roots.size;
  }

  private observe(root: Element, records: MutationRecord[]): void {
    for (const record of records) {
      if (record.type === "characterData" || record.target !== root) {
        const at = record.target instanceof Element ? record.target : record.target.parentElement;
        const row = at?.closest(ROW);
        if (row) this.mark(row);
      } else {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(ROW)) this.mark(node);
          else for (const row of node.querySelectorAll(ROW)) this.mark(row);
        }
      }
    }
    if (records.some((record) => record.removedNodes.length)) this.sweep();
  }

  private mark(row: Element): void {
    if (!WORDS_ROW.test(row.getAttribute("data-timeline-row-id") ?? "")) return;
    this.dirty.add(row);
    if (this.frame || this.wait) return;
    const due = this.last + REPAINT_MS - performance.now();
    if (due > 0) this.wait = window.setTimeout(() => this.schedule(), due);
    else this.schedule();
  }

  private schedule(): void {
    this.wait = 0;
    this.frame = requestAnimationFrame(() => this.flush());
  }

  private flush(): void {
    this.frame = 0;
    this.last = performance.now();
    const started = this.stats ? performance.now() : 0;
    const rows = [...this.dirty];
    this.dirty.clear();
    for (const row of rows) {
      this.unpaint(row);
      const using = matchers.get(threadOf(row));
      if (row.isConnected && enabled && using) this.paint(row, using);
    }
    if (this.stats) {
      const took = performance.now() - started;
      this.stats.paints++;
      this.stats.rows += rows.length;
      this.stats.ms += took;
      this.stats.slowest = Math.max(this.stats.slowest, took);
    }
  }

  /** Forgets rows BB has unmounted; their ranges point into nodes that are gone. */
  private sweep(): void {
    for (const row of [...this.painted.keys()]) if (!row.isConnected) this.unpaint(row);
  }

  private unpaint(row: Element): void {
    const held = this.painted.get(row);
    if (!held) return;
    for (const { highlight, range } of held) highlight.delete(range);
    this.painted.delete(row);
  }

  private highlightFor(look: Look): Highlight {
    const name = highlightName(look);
    let highlight = this.highlights.get(name);
    if (!highlight) {
      highlight = new Highlight();
      this.highlights.set(name, highlight);
      CSS.highlights.set(name, highlight);
      this.sheet.insertRule(highlightRule(look), this.sheet.cssRules.length);
    }
    return highlight;
  }

  private paint(row: Element, using: Matcher): void {
    const held: { highlight: Highlight; range: Range }[] = [];
    for (const chunk of textChunks(row)) {
      for (const found of findTerms(chunk.text, using)) {
        const range = rangeOf(chunk.nodes, found.start, found.end);
        if (!range) continue;
        const highlight = this.highlightFor(found.hit.look);
        highlight.add(range);
        held.push({ highlight, range });
      }
    }
    if (held.length) this.painted.set(row, held);
  }
}

/** The text of one paragraph and the text nodes it is made of, in order. */
interface Chunk {
  text: string;
  nodes: { node: Text; start: number }[];
}

/**
 * The paintable text of a row, a paragraph at a time. A phrase may run across
 * nested elements (`pinned **folders**`), so the nodes of one paragraph are joined
 * and matched as one string; a paragraph's edge ends a phrase.
 */
export function textChunks(row: Element): Chunk[] {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      return SKIPPED.has(element.tagName.toUpperCase()) || (element as HTMLElement).isContentEditable ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
  const chunks: Chunk[] = [];
  let current: Chunk | null = null;
  let owner: Element | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data) continue;
    const paragraph = text.parentElement?.closest(BREAKS) ?? row;
    if (!current || paragraph !== owner) {
      current = { text: "", nodes: [] };
      owner = paragraph;
      chunks.push(current);
    }
    current.nodes.push({ node: text, start: current.text.length });
    current.text += text.data;
  }
  return chunks;
}

/** A Range over `[start, end)` of a paragraph's joined text. */
function rangeOf(nodes: Chunk["nodes"], start: number, end: number): Range | null {
  let first = -1;
  let last = -1;
  for (let i = 0; i < nodes.length; i++) {
    const entry = nodes[i]!;
    if (first < 0 && start < entry.start + entry.node.data.length) first = i;
    if (end <= entry.start + entry.node.data.length) {
      last = i;
      break;
    }
  }
  if (first < 0 || last < 0) return null;
  const a = nodes[first]!;
  const b = nodes[last]!;
  const range = new Range();
  range.setStart(a.node, start - a.start);
  range.setEnd(b.node, end - b.start);
  return range;
}
