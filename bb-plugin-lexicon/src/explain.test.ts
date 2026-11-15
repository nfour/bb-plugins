import test from "node:test";
import assert from "node:assert/strict";
import { explain } from "./explain.ts";
import { compile, findTerms, type Entry } from "./lexicon.ts";

const entry: Entry = { id: "sync", term: "Synced View", kind: "option", aliases: ["Sync View Order", "Synced Order"], code: ["syncedView"], note: "Orders the tree like the cards.", status: "auto", by: "agent" };
const hitFor = (word: string) => {
  const m = compile([entry, { id: "old", term: "Flat View", kind: "option", aliases: [], code: [], retired: ["List Mode"] }]);
  const found = findTerms(word, m);
  assert.equal(found.length, 1);
  return found[0]!.hit;
};

test("a term says what it is, its meaning, its other wordings and whose it is", () => {
  const out = explain(hitFor("Synced View"), "Synced View");
  assert.equal(out.title, "Synced View");
  assert.equal(out.kind, "Option, added by an agent");
  assert.deepEqual(out.lines, ["Orders the tree like the cards.", "Also called: Sync View Order, Synced Order"]);
});

test("an alias names the term it belongs to and is not listed among the other wordings", () => {
  const out = explain(hitFor("Sync View Order"), "Sync View Order");
  assert.equal(out.title, "Synced View");
  assert.equal(out.lines[0], '"Sync View Order" is another wording of Synced View.');
  assert.equal(out.lines.at(-1), "Also called: Synced Order");
});

test("code and old wordings are said so", () => {
  assert.match(explain(hitFor("syncedView"), "syncedView").lines[0]!, /how Synced View is spelled in code/);
  assert.match(explain(hitFor("List Mode"), "List Mode").lines[0]!, /old wording; it is now Flat View/);
});

test("a flagged or switched-off term is marked, and an outcome shows its tone", () => {
  const stale = explain(hitFor("Synced View"), "Synced View");
  assert.ok(!stale.lines.some((l) => l.startsWith("May be")));
  const hit = { ...hitFor("Synced View"), entry: { ...entry, stale: "its code is gone", tone: "bad" as const, disabled: true, status: "pinned" as const } };
  const out = explain(hit, "Synced View");
  assert.equal(out.kind, "Option (bad), switched off");
  assert.ok(out.lines.includes("May be out of date: its code is gone"));
});
