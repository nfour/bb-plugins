// Candidates for the lexicon, counted from text the project already has: its
// source files or its session replies. Pure; the server reads the text. A
// candidate is a compound name (camelCase, snake_case, kebab-case) or a
// backticked span that turns up in several documents, and is not already a term.
import { isCompound } from "./symbols.ts";

export interface Candidate {
  term: string;
  /** Documents (files or replies) it appears in. */
  docs: number;
  /** One place it was seen, to judge it by. */
  example: string;
}

const TOKEN = /[A-Za-z_$][\w$]*(?:-[A-Za-z0-9_$]+)*/g;
const SPAN = /`([^`\n]{2,48})`/g;

/** A kebab-case token of two or more parts, like `bb-plugin-lexicon` or `frozen-folders`. */
const isKebab = (token: string): boolean => /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(token) && token.length >= 6 && token.length <= 48;

/** Platform and helper names (React hooks, DOM calls, get/set/handle functions, data- and aria- attributes) are code internals: the lexicon is for concepts, features, options and interfaces. */
const PLATFORM = new Set(["className", "classList", "parentElement", "textContent", "innerHTML", "localStorage", "querySelector", "querySelectorAll", "MutationObserver", "IntersectionObserver", "ResizeObserver", "requestAnimationFrame", "startsWith", "endsWith", "forEach", "stopPropagation", "preventDefault", "createElement", "appendChild", "dataset", "ownerDocument", "defaultView", "childNodes", "nodeType", "tagName"]);
export const isInternal = (token: string): boolean => PLATFORM.has(token) || /^(use|get|set|add|remove|clear|handle|on|is|has|create|update|read|write)[_A-Z]/.test(token) || /^(data|aria)-/.test(token);

/** Terms-like tokens of one document, each once. `spans` also takes backticked text, as replies and docs use it. */
export function tokensOf(text: string, spans: boolean): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0];
    if ((isCompound(token) || isKebab(token)) && !isInternal(token)) found.add(token);
  }
  if (spans) {
    for (const match of text.matchAll(SPAN)) {
      const span = match[1]!.trim();
      if (!isInternal(span) && /^[\w$.:/-]+$/.test(span) && !/^[\d.:/-]+$/.test(span) && !span.includes("/") && !span.includes("..")) found.add(span);
    }
  }
  return found;
}

/** Counts, over `documents` (name, text), in how many each term appears; keeps those in at least `minDocs`, most widespread first, skipping what `owned` says is already a term. */
export function mineTerms(documents: Iterable<{ name: string; text: string }>, options: { spans: boolean; minDocs: number; limit: number; owned: (term: string) => boolean }): Candidate[] {
  const counts = new Map<string, Candidate>();
  for (const { name, text } of documents) {
    for (const term of tokensOf(text, options.spans)) {
      const held = counts.get(term);
      if (held) held.docs++;
      else counts.set(term, { term, docs: 1, example: name });
    }
  }
  return [...counts.values()]
    .filter((c) => c.docs >= options.minDocs && !options.owned(c.term))
    .sort((a, b) => b.docs - a.docs || b.term.length - a.term.length || (a.term < b.term ? -1 : 1))
    .slice(0, options.limit);
}
