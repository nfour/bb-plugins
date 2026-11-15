import { tabAway } from "./tab.ts";
// Paints the lexicon over the thread timeline with the CSS Custom Highlight API.
//
// A highlight is a set of Ranges the browser paints with `::highlight(name)`
// rules, so nothing is added to BB's DOM: React cannot fight it and a streaming
// row needs no care beyond repainting what changed. One highlight per
// (shape, hue, alias) look, its rule made on first use in one adopted stylesheet.
//
// Only rows BB has mounted are painted (the timeline is virtualized). One
// MutationObserver sits on each `[data-timeline-items]`; a change marks its row
// dirty and the dirty rows are repainted together in the next frame. A change is
// traced to its paragraph and only that paragraph is repainted, so a streaming
// reply costs one pass over its last paragraph per frame, however long it is, and
// the rest of the page costs nothing. The composer and everything outside the timeline are never
// observed, and nothing here runs per scroll or per keystroke. A click on a
// painted word (one listener on the document, which returns at once for a click
// outside a timeline row) opens a small card saying which term it is.
import { explain } from "./explain.ts";
import { findTerms, highlightName, highlightRule, type Hit, type Look, type Matcher } from "./lexicon.ts";
import { closePopover, showPopover } from "./popover.ts";
import { joinChunks, locate, outermost, type Chunk } from "./spans.ts";

const ITEMS = "[data-timeline-items]";
const ROW = "[data-timeline-row-id]";
/** Rows of the agent's words, and with `paintPrompts` the reader's too; tool and turn rows carry other text. */
const REPLY_ROW = /:assistant[-:]/;
const PROMPT_ROW = /:user[-:]/;
/** Where a phrase cannot run on: the nearest of these around a text node is its paragraph. */
const BREAKS = "p, li, h1, h2, h3, h4, h5, h6, td, th, blockquote, div, dd, dt, figcaption, summary, section";
/** Never painted: code blocks (their colours are the syntax theme's), controls and times. */
const SKIPPED = new Set(["PRE", "BUTTON", "TIME", "SVG", "STYLE", "SCRIPT", "TEXTAREA", "INPUT", "SELECT", "NOSCRIPT"]);
/** Where a click belongs to the thing clicked, not to a word in it. */
const INTERACTIVE = "a, button, input, textarea, select, summary, [role=button], [role=link]";
const SKIPPED_SELECTOR = [...SKIPPED].join(",");
/** The least time between two repaints: a streaming reply changes every frame, its colours need not. */
const REPAINT_MS = 100;
/** How often the page is checked for timelines that came or went (thread switches replace them). */
const SCAN_MS = 400;

const supported = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";

/** One lexicon per thread: two panes on different projects each paint with their own, and a thread with none is left plain. */
const matchers = new Map<string, Matcher>();
let enabled = true;
let prompts = true;
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

/** The `paintPrompts` setting: whether the reader's own messages are painted too. */
export function setPrompts(value: boolean): void {
  if (prompts === value) return;
  prompts = value;
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
  /** The ranges each row holds and the paragraph each was found in, to take them out again. */
  private readonly painted = new Map<Element, Held[]>();
  private readonly roots = new Map<Element, MutationObserver>();
  /** Rows to repaint and, for each, the paragraphs that changed (the row itself: all of it). */
  private readonly dirty = new Map<Element, Set<Element>>();
  private frame = 0;
  private wait = 0;
  private last = 0;
  /** The threads last reported to `onThreads`, joined. */
  private seen = "";
  /** The scan's interval; 0 while the tab is in the background. */
  private timer = 0;
  private readonly stats: Stats | null;

  constructor() {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, this.sheet];
    this.stats = localStorage.getItem("lexicon:debug") ? (window.__lexiconStats = { paints: 0, ms: 0, slowest: 0, rows: 0, terms: 0, roots: 0 }) : null;
    document.addEventListener("visibilitychange", this.visibility);
    document.addEventListener("click", this.click);
    this.arm();
    this.scan();
  }

  /** A plain click on a painted word explains it. Links, controls and a selection being made are left alone. */
  private readonly click = (event: MouseEvent): void => {
    if (event.button !== 0 || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target instanceof Element ? event.target : null;
    const row = target?.closest(ROW);
    const held = row && this.painted.get(row);
    if (!target || !held || target.closest(INTERACTIVE) || !window.getSelection()?.isCollapsed) return;
    const at = held.find(({ range }) => [...range.getClientRects()].some((r) => event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom));
    if (!at) {
      closePopover();
      return;
    }
    showPopover(explain(at.hit, at.range.toString()), at.range.getBoundingClientRect());
  };

  /** The scan only has to notice timelines that came or went, so it sleeps with the tab and looks once on return. */
  private arm(): void {
    if (!this.timer && !tabAway()) this.timer = window.setInterval(() => this.scan(), SCAN_MS);
  }
  private readonly visibility = (): void => {
    if (tabAway()) {
      window.clearInterval(this.timer);
      this.timer = 0;
    } else {
      this.arm();
      this.scan();
    }
  };

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

  private wordsRow(row: Element): boolean {
    const id = row.getAttribute("data-timeline-row-id") ?? "";
    return REPLY_ROW.test(id) || (prompts && PROMPT_ROW.test(id));
  }

  dispose(): void {
    closePopover();
    document.removeEventListener("click", this.click);
    document.removeEventListener("visibilitychange", this.visibility);
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
      if (record.type === "characterData") this.markAt(record.target);
      else if (record.target === root) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(ROW)) this.mark(node);
          else for (const row of node.querySelectorAll(ROW)) this.mark(row);
        }
      } else {
        // Inside a row: an added paragraph is its own span to paint; anything else changes the paragraph it sits in.
        for (const node of record.addedNodes) {
          if (node instanceof Element && node.matches(BREAKS)) this.markAt(node, node);
          else this.markAt(node);
        }
        for (const node of record.removedNodes) if (!(node instanceof Element && node.matches(BREAKS))) this.markAt(record.target);
      }
    }
    if (records.some((record) => record.removedNodes.length)) this.sweep();
  }

  /** Marks the paragraph `node` is in (or `paragraph` itself) dirty; a change in code fences or a control is never painted, so it is not even marked. */
  private markAt(node: Node, paragraph?: Element): void {
    const at = node instanceof Element ? node : node.parentElement;
    const row = at?.closest(ROW);
    if (!row || at!.closest(SKIPPED_SELECTOR)) return;
    const para = paragraph ?? at!.closest(BREAKS);
    this.mark(row, para && row.contains(para) ? para : row);
  }

  private mark(row: Element, para: Element = row): void {
    if (!this.wordsRow(row)) return;
    const held = this.dirty.get(row);
    if (!held) this.dirty.set(row, new Set([para]));
    else if (para === row) held.clear(), held.add(row);
    else if (!held.has(row)) held.add(para);
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
    const batch = [...this.dirty];
    this.dirty.clear();
    for (const [row, paragraphs] of batch) {
      const using = matchers.get(threadOf(row));
      const live = row.isConnected && enabled && using && this.wordsRow(row);
      if (!live || paragraphs.has(row)) {
        this.unpaint(row);
        if (live) this.paint(row, row, using);
        continue;
      }
      for (const para of outermost([...paragraphs], (outer, inner) => outer.contains(inner))) {
        if (para.isConnected && row.contains(para)) this.paint(row, para, using);
      }
    }
    if (this.stats) {
      const took = performance.now() - started;
      this.stats.paints++;
      this.stats.rows += batch.length;
      this.stats.ms += took;
      this.stats.slowest = Math.max(this.stats.slowest, took);
    }
  }

  /** Forgets rows BB has unmounted and the ranges of paragraphs it has removed; their ranges point into nodes that are gone. */
  private sweep(): void {
    for (const [row, held] of [...this.painted]) {
      if (!row.isConnected) {
        this.unpaint(row);
        continue;
      }
      const alive = held.filter((h) => h.owner.isConnected);
      if (alive.length === held.length) continue;
      for (const h of held) if (!h.owner.isConnected) h.highlight.delete(h.range);
      if (alive.length) this.painted.set(row, alive);
      else this.painted.delete(row);
    }
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

  /** Paints `scope` (the row, or one paragraph of it): what the row held inside it is taken out first, and so are ranges of paragraphs BB has removed. */
  private paint(row: Element, scope: Element, using: Matcher): void {
    const before = this.painted.get(row) ?? [];
    const held: Held[] = [];
    for (const old of before) {
      if (scope.contains(old.owner) || !old.owner.isConnected) old.highlight.delete(old.range);
      else held.push(old);
    }
    for (const chunk of textChunks(scope)) {
      for (const found of findTerms(chunk.text, using)) {
        const range = rangeOf(chunk.nodes, found.start, found.end);
        if (!range) continue;
        const highlight = this.highlightFor(found.hit.look);
        highlight.add(range);
        held.push({ highlight, range, owner: chunk.owner, hit: found.hit });
      }
    }
    if (held.length) this.painted.set(row, held);
    else this.painted.delete(row);
  }
}

interface Held {
  highlight: Highlight;
  range: Range;
  owner: Element;
  hit: Hit;
}

/**
 * The paintable text under `root`, a paragraph at a time. A phrase may run across
 * nested elements (`pinned **folders**`), so the nodes of one paragraph are joined
 * and matched as one string; a paragraph's edge ends a phrase.
 */
export function textChunks(root: Element): Chunk<Text, Element>[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const element = node as Element;
      return SKIPPED.has(element.tagName.toUpperCase()) || (element as HTMLElement).isContentEditable ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
  const pieces: { node: Text; data: string; owner: Element }[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    pieces.push({ node: text, data: text.data, owner: text.parentElement?.closest(BREAKS) ?? root });
  }
  return joinChunks(pieces);
}

/** A Range over `[start, end)` of a paragraph's joined text. */
function rangeOf(nodes: Chunk<Text, Element>["nodes"], start: number, end: number): Range | null {
  const at = locate(nodes, start, end);
  if (!at) return null;
  const range = new Range();
  range.setStart(at.first, at.startOffset);
  range.setEnd(at.last, at.endOffset);
  return range;
}
