import test from "node:test";
import assert from "node:assert/strict";
import { properNoun, houseForm, compile, findTerms, highlightName, highlightRule, parseLexicon, type Matcher } from "./lexicon.ts";

const file = (terms: unknown[]) => JSON.stringify({ terms });

const sample = file([
  { id: "diff-plus", term: "bb-plugin-diff-plus", kind: "name", aliases: ["Diff Plus"], hue: 200 },
  { id: "pinned-folders", term: "pinned folders", kind: "feature", parent: "diff-plus", aliases: ["frozen folders", "stuck folders"], code: ["diff-plus-pinned", "useStuckRows"] },
  { id: "tree", term: "tree", kind: "feature", parent: "diff-plus" },
  { id: "shipped", term: "shipped", kind: "outcome", tone: "good" },
  { id: "reverted", term: "reverted", kind: "outcome", tone: "bad" },
  { id: "click", term: "click", kind: "action" },
]);

const matcherOf = (text: string): Matcher => {
  const parsed = parseLexicon(text);
  assert.deepEqual(parsed.issues, []);
  return compile(parsed.entries);
};
const words = (text: string, matcher: Matcher) => findTerms(text, matcher).map((f) => text.slice(f.start, f.end));

test("a clean file parses without issues", () => {
  const { entries, issues } = parseLexicon(sample);
  assert.equal(entries.length, 6);
  assert.deepEqual(issues, []);
});

test("bad JSON and a wrong shape are one error each", () => {
  assert.equal(parseLexicon("{").issues[0]?.level, "error");
  assert.equal(parseLexicon("[]").issues[0]?.message, 'expected an object with a "terms" array');
  assert.deepEqual(parseLexicon("[]").entries, []);
});

test("a duplicate id, a bad kind and a short term drop the entry; the rest load", () => {
  const { entries, issues } = parseLexicon(
    file([
      { id: "a", term: "alpha", kind: "name" },
      { id: "a", term: "again", kind: "name" },
      { id: "b", term: "beta", kind: "mood" },
      { id: "c", term: "c", kind: "name" },
      { id: "Bad Id", term: "gamma", kind: "name" },
      { id: "d", term: "delta", kind: "name" },
    ]),
  );
  assert.deepEqual(entries.map((e) => e.id), ["a", "d"]);
  assert.equal(issues.filter((i) => i.level === "error").length, 4);
});

test("a wording has one owner, compared without case; the later claim loses", () => {
  const { entries, issues } = parseLexicon(
    file([
      { id: "a", term: "pinned folders", kind: "feature", aliases: ["Frozen Folders"] },
      { id: "b", term: "frozen folders", kind: "feature", aliases: ["stuck folders", "PINNED FOLDERS"] },
    ]),
  );
  assert.deepEqual(entries[1]?.aliases, ["stuck folders"]);
  assert.equal(entries[1]?.term, "");
  assert.deepEqual(issues.map((i) => i.message), ['"frozen folders" already belongs to "a"', '"PINNED FOLDERS" already belongs to "a"']);
});

test("a missing parent or a cycle is reported and the link dropped", () => {
  const { entries, issues } = parseLexicon(
    file([
      { id: "a", term: "alpha", kind: "feature", parent: "ghost" },
      { id: "b", term: "beta", kind: "feature", parent: "c" },
      { id: "c", term: "gamma", kind: "feature", parent: "b" },
    ]),
  );
  assert.equal(entries[0]?.parent, undefined);
  assert.equal(issues.length, 2);
  assert.ok(entries.some((e) => e.parent === undefined && e.id !== "a"), "breaking the cycle at its second link is enough");
});

test("a same-kind child takes its parent's hue; a feature under a name keeps the feature hue; a term's own hue wins; an outcome's tone picks one", () => {
  const matcher = matcherOf(sample);
  const hue = (word: string) => matcher.hits.get(word)!.look.hue;
  assert.equal(hue("bb-plugin-diff-plus"), 200);
  assert.equal(hue("pinned folders"), 190);
  assert.equal(hue("tree"), 190);
  assert.equal(hue("shipped"), 150);
  assert.equal(hue("reverted"), 20);
  assert.equal(hue("click"), 320);
});

test("aliases are dotted, identifiers take the code shape in the term's colour", () => {
  const matcher = matcherOf(sample);
  const look = (word: string) => matcher.hits.get(word)!.look;
  assert.deepEqual(look("frozen folders"), { shape: "feature", hue: 190, alias: true });
  assert.deepEqual(look("usestuckrows"), { shape: "code", hue: 190, alias: false });
  assert.equal(highlightName(look("frozen folders")), "lexicon-feature-190-alias");
});

test("matches whole words, any case, longest first", () => {
  const matcher = matcherOf(sample);
  assert.deepEqual(words("Shipped the tree; the Pinned Folders were reverted.", matcher), ["Shipped", "tree", "Pinned Folders", "reverted"]);
  assert.deepEqual(words("reshipped, retreeing, shippedly", matcher), []);
});

test("a hyphen or underscore joins a word to its neighbour; a trailing .ext does too", () => {
  const matcher = matcherOf(sample);
  assert.deepEqual(words("tree-shaking and file_tree and tree.ts", matcher), []);
  assert.deepEqual(words("the bb-plugin-diff-plus plugin, in `diff-plus-pinned` (useStuckRows).", matcher), ["bb-plugin-diff-plus", "diff-plus-pinned", "useStuckRows"]);
  assert.deepEqual(words("a tree. Next: tree, tree!", matcher), ["tree", "tree", "tree"]);
});

test("positions are in the text's own units", () => {
  const matcher = matcherOf(sample);
  const [found] = findTerms("ab shipped", matcher);
  assert.deepEqual([found?.start, found?.end], [3, 10]);
});

test("an empty lexicon matches nothing", () => {
  assert.deepEqual(findTerms("anything", compile([])), []);
});

test("no rule draws a line: links already do", () => {
  for (const shape of ["name", "feature", "code", "action", "outcome", "topic"] as const) {
    for (const alias of [false, true]) assert.doesNotMatch(highlightRule({ shape, hue: 200, alias }), /text-decoration/);
  }
});

test("a rule carries colour in both schemes; an alias keeps the text's own ink", () => {
  const rule = highlightRule({ shape: "feature", hue: 200, alias: false });
  assert.match(rule, /^::highlight\(lexicon-feature-200\) \{/);
  assert.match(rule, /color: light-dark\(/);
  assert.match(rule, /background-color: light-dark\(/);
  assert.doesNotMatch(highlightRule({ shape: "feature", hue: 190, alias: true }), /[^-]color:/);
  assert.doesNotMatch(highlightRule({ shape: "action", hue: 320, alias: false }), /background-color/);
});

test("one-token wordings are looked up, several-word ones matched; the longer overlap wins", () => {
  const matcher = compile(
    parseLexicon(file([{ id: "a", term: "pinned", kind: "feature" }, { id: "b", term: "pinned folders", kind: "feature" }, { id: "c", term: "folder", kind: "action" }])).entries,
  );
  assert.deepEqual(words("pinned folders and a pinned thing, one folder", matcher), ["pinned folders", "pinned", "folder"]);
});

test("concepts are written as proper nouns; identifiers and verbs are left alone", () => {
  assert.equal(properNoun("sync view order"), "Sync View Order");
  assert.equal(properNoun("full text on hover"), "Full Text on Hover");
  assert.equal(properNoun("Plugin SDK"), "Plugin SDK");
  assert.equal(properNoun("bb-plugin-diff-plus"), "bb-plugin-diff-plus");
  assert.equal(properNoun("useStuckRows"), "useStuckRows");
  assert.equal(houseForm("flat list", "option"), "Flat List");
  assert.equal(houseForm("reverted", "outcome"), "reverted");
  assert.equal(houseForm("useStuckRows", "code"), "useStuckRows");
});
