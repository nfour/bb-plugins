import test from "node:test";
import assert from "node:assert/strict";
import { exportedNames, isCompound, packageName, symbolEntries } from "./symbols.ts";
import { exportTerms } from "./export.ts";
import { DEFAULT_TERMS } from "./defaults.ts";
import { parseLexicon } from "./lexicon.ts";

test("only run-together names count: single words are the language's", () => {
  assert.deepEqual(["useStuckRows", "RETRY_LIMIT", "show_recent", "bandAt", "Tree", "install", "ab_c", "x".repeat(60)].map(isCompound), [true, true, true, true, false, false, false, false]);
});

test("exported declarations of every shape, and nothing unexported", () => {
  const source = `
    export function useStuckRows() {}
    export default async function loadLexicon() {}
    export const RETRY_LIMIT = 3;
    export interface TreeOptions {}
    export type FolderNode = {};
    export class RowCache {}
    function privateHelper() {}
    const notExported = 1;
    export const tree = 1;
  `;
  assert.deepEqual(exportedNames(source).sort(), ["FolderNode", "RETRY_LIMIT", "RowCache", "TreeOptions", "loadLexicon", "useStuckRows"]);
});

test("a package name is read, a broken or odd one is not", () => {
  assert.equal(packageName('{"name":"bb-plugin-lexicon"}'), "bb-plugin-lexicon");
  assert.equal(packageName('{"name":"@acme/tool"}'), "@acme/tool");
  assert.equal(packageName("{"), null);
  assert.equal(packageName('{"name":"a b"}'), null);
});

test("learned entries are names and code, packages first, capped", () => {
  const entries = symbolEntries(["bb-plugin-lexicon"], ["useStuckRows", "bandAt2x", "useStuckRows"]);
  assert.deepEqual(entries.map((e) => [e.id, e.kind]), [["pkg:bb-plugin-lexicon", "name"], ["sym:useStuckRows", "code"], ["sym:bandAt2x", "code"]]);
});

test("the built-in terms are a clean lexicon", () => {
  const { entries, issues } = parseLexicon(JSON.stringify({ terms: DEFAULT_TERMS }));
  assert.deepEqual(issues, []);
  assert.equal(entries.length, DEFAULT_TERMS.length);
});

test("every export format carries every term, and json reads back", () => {
  const terms = DEFAULT_TERMS.slice(0, 3);
  assert.deepEqual(parseLexicon(exportTerms(terms, "json")).entries.map((e) => e.id), terms.map((e) => e.id));
  for (const format of ["md", "yaml", "txt"] as const) {
    const out = exportTerms(terms, format);
    for (const term of terms) assert.ok(out.includes(term.term), `${format} has ${term.term}`);
  }
});
