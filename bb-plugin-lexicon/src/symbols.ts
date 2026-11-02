// Names the project's own source gives the lexicon for free: package names and
// the compound identifiers it exports. A declaration scan, not a parser: BB has
// no language server to ask and the TypeScript compiler would add megabytes to
// the server bundle, while a declaration's name is on one line. Single-word names
// (`Tree`, `install`) are left out on purpose: they are words of the language
// and would paint everywhere. A project that wants one adds it to its lexicon.
import type { Entry } from "./lexicon.ts";

/** The most names learned from one project; more would only be noise. */
export const MAX_SYMBOLS = 1500;
const MIN_LENGTH = 6;
const MAX_LENGTH = 48;

const DECLARATION = /\bexport\s+(?:default\s+)?(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|const|let|var)\s+([A-Za-z_$][\w$]*)/g;

/** camelCase, PascalCase with a second hump, or SCREAMING_SNAKE: more than one word run together. */
export function isCompound(name: string): boolean {
  if (name.length < MIN_LENGTH || name.length > MAX_LENGTH || name.includes("$")) return false;
  if (/[a-z][A-Z]/.test(name)) return true;
  return /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(name) || /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(name);
}

/** The compound names a source file exports. */
export function exportedNames(source: string): string[] {
  const names = new Set<string>();
  for (const match of source.matchAll(DECLARATION)) {
    const name = match[1]!;
    if (isCompound(name)) names.add(name);
  }
  return [...names];
}

/** A package's `name` from its package.json text, or null. */
export function packageName(json: string): string | null {
  try {
    const name: unknown = (JSON.parse(json) as { name?: unknown }).name;
    return typeof name === "string" && /^[a-z0-9@][\w./@-]{3,60}$/i.test(name) ? name : null;
  } catch {
    return null;
  }
}

/** Entries for what a scan found: package names as names, identifiers as code. Capped, most-used-looking (longest) kept. */
export function symbolEntries(packages: Iterable<string>, identifiers: Iterable<string>): Entry[] {
  const entries: Entry[] = [];
  for (const name of new Set(packages)) entries.push({ id: `pkg:${name}`, term: name, kind: "name", aliases: [], code: [] });
  const identifierList = [...new Set(identifiers)].sort((a, b) => b.length - a.length || (a < b ? -1 : 1)).slice(0, MAX_SYMBOLS);
  for (const name of identifierList) entries.push({ id: `sym:${name}`, term: name, kind: "code", aliases: [], code: [] });
  return entries;
}
