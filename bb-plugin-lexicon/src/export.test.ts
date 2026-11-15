import test from "node:test";
import assert from "node:assert/strict";
import { exportTerms, FORMATS } from "./export.ts";
import type { Entry } from "./lexicon.ts";

const entries: Entry[] = [
  { id: "frozen-folders", term: "Frozen Folders", kind: "feature", parent: "diff-plus", aliases: ["Pinned Folders", 'Stuck "Folders"'], code: ["useStuckRows"] },
  { id: "shipped", term: "shipped", kind: "outcome", tone: "good", aliases: [], code: [], note: "Work that reached users | not just merged" },
];

test("json round-trips every entry", () => {
  assert.deepEqual(JSON.parse(exportTerms(entries, "json")), { terms: entries });
});

test("yaml quotes scalars and lists wordings", () => {
  const text = exportTerms(entries, "yaml");
  assert.match(text, /^terms:\n {2}- id: "frozen-folders"/);
  assert.match(text, /aliases: \["Pinned Folders", "Stuck \\"Folders\\""\]/);
  assert.match(text, /tone: good/);
  assert.match(text, /note: "Work that reached users \| not just merged"/);
});

test("md is rows with one row per term", () => {
  const rows = exportTerms(entries, "md").split("\n");
  assert.equal(rows.length, 4);
  assert.match(rows[2]!, /^\| Frozen Folders \| feature \| diff-plus \| Pinned Folders, Stuck "Folders" \| `useStuckRows` \| {2}\|$/);
  assert.match(rows[3]!, /outcome \(good\)/);
  // The meaning is kept, and a pipe in it does not split the row.
  assert.match(rows[3]!, /\| Work that reached users \\\| not just merged \|$/);
});

test("txt is one line per term", () => {
  const lines = exportTerms(entries, "txt").split("\n");
  assert.equal(lines[0], 'Frozen Folders [feature of diff-plus] also: Pinned Folders, Stuck "Folders" code: useStuckRows');
  assert.equal(lines[1], "shipped [outcome] - Work that reached users | not just merged");
});

test("json keeps what yaml and the others carry, so a copy can be imported again", () => {
  const back = JSON.parse(exportTerms(entries, "json")).terms as Entry[];
  assert.equal(back[1]!.note, entries[1]!.note);
});

test("every format handles an empty lexicon", () => {
  for (const format of FORMATS) assert.doesNotThrow(() => exportTerms([], format));
});
