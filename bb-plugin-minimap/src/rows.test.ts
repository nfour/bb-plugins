import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta, flatten, itemsOf, mergeNewest, patchRow, prependOlder, type Memo, type RowOp, type Row } from "./rows.ts";

const r = (id: string, v = "") => ({ id, v });
const ids = (rows: { id: string }[] | null) => rows?.map((x) => x.id + ((x as { v?: string }).v ?? ""));

test("a delta without an order replaces rows where they are", () => {
  assert.deepEqual(ids(applyDelta([r("a"), r("b")], { upsertRows: [r("b", "!")] })), ["a", "b!"]);
});

test("a delta without an order cannot add a row it does not place", () => {
  assert.equal(applyDelta([r("a")], { upsertRows: [r("z")] }), null);
});

test("an order of a stretch and new ids rebuilds the page", () => {
  const page = [r("a"), r("b"), r("c")];
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [r("c", "!"), r("d")], rowOrder: [[0, 3], "d"] })), ["a", "b", "c!", "d"]);
});

test("an order may drop rows; an id in it names a new row, never a held one", () => {
  const page = [r("a"), r("b"), r("c")];
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [], rowOrder: [[1, 2]] })), ["b", "c"]);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[1, 2], "a"] }), null);
});

test("a stretch out of range, or an id nowhere, cannot be applied", () => {
  const page = [r("a"), r("b")];
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 3]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[1, 2]] }), null, "start 1 and 2 rows is 3 rows of 2");
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[-1, 1]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, -1]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["nope"] }), null);
});

test("an upsert the order never places would lose a row, so it is refused", () => {
  assert.equal(applyDelta([r("a"), r("b")], { upsertRows: [r("c")], rowOrder: [[0, 2]] }), null);
});

/** A row with nesting like a turn's: a string, a list of children and an object. */
const deep = () => ({ id: "t", status: "working", text: "He", meta: { n: 1 }, children: [{ id: "c0", text: "a" }, { id: "c1", text: "b" }] });
const patch = (ops: RowOp[]) => patchRow(deep(), ops);

test("a patch appends to a string, sets a value and deletes a key", () => {
  assert.deepEqual(patch([["append", ["text"], "llo"]]), { ...deep(), text: "Hello" });
  assert.deepEqual(patch([["set", ["status"], "done"]]), { ...deep(), status: "done" });
  const { meta, ...rest } = deep();
  assert.deepEqual(patch([["delete", ["meta"]]]), rest);
  assert.equal(meta.n, 1);
});

test("a patch follows nested paths and sets the next index of a list", () => {
  assert.deepEqual(patch([["append", ["children", 1, "text"], "!"]])?.children[1], { id: "c1", text: "b!" });
  const grown = patch([["set", ["children", 2], { id: "c2", text: "c" }]]);
  assert.deepEqual(grown?.children.map((c) => c.id), ["c0", "c1", "c2"]);
  assert.deepEqual(patch([["set", ["meta", "n"], 5]])?.meta, { n: 5 });
});

test("a patch never changes the row it was made from, and shares what it did not touch", () => {
  const row = deep();
  const frozen = JSON.stringify(row);
  const next = patchRow(row, [["append", ["children", 0, "text"], "z"], ["append", ["text"], "y"], ["set", ["children", 2], { id: "c2", text: "" }]])!;
  assert.equal(JSON.stringify(row), frozen);
  assert.equal(next.children[1], row.children[1]);
  assert.equal(next.meta, row.meta);
  assert.notEqual(next.children, row.children);
});

test("ops that do not fit the row are refused", () => {
  assert.equal(patch([["append", ["status", "x"], "!"]]), null, "a path through a string");
  assert.equal(patch([["append", ["meta"], "!"]]), null, "append to a non-string");
  assert.equal(patch([["append", ["nope"], "!"]]), null, "append to a missing key");
  assert.equal(patch([["delete", ["nope"]]]), null, "delete of a missing key");
  assert.equal(patch([["delete", ["children", 0]]]), null, "delete of an array element");
  assert.equal(patch([["set", ["children", 5], 1]]), null, "set past the end of a list");
  assert.equal(patch([["set", ["children", 5, "id"], 1]]), null, "set through a missing element");
  assert.equal(patch([["set", [], 1]]), null, "an empty path");
  assert.equal(patch([["set", ["meta", "deeper", "x"], 5]]), null, "set through a missing key");
  assert.equal(patch([["set", ["id"], "other"]]), null, "a patch that changes the id");
  assert.equal(patch([["set", ["kind"], "other"]]), null, "a patch that changes the kind");
  assert.equal(patch([["delete", ["id"]]]), null, "a patch that removes the id");
  assert.equal(patch([["set", ["status"], "ok"], ["append", ["gone"], "!"]]), null, "the second op fails, so the patch does");
});

test("a delta's patches are applied to the rows held, in place or with an order", () => {
  const page = [{ id: "a", text: "x" }, { id: "b", text: "y" }];
  const patchRows = [{ id: "b", ops: [["append", ["text"], "!"]] as RowOp[] }];
  assert.deepEqual(applyDelta(page, { upsertRows: [], patchRows }), [page[0], { id: "b", text: "y!" }]);
  assert.equal(page[1]!.text, "y");
  const moved = applyDelta(page, { upsertRows: [{ id: "c", text: "" }], patchRows, rowOrder: [[1, 1], [0, 1], "c"] });
  assert.deepEqual(moved?.map((x) => x.text), ["y!", "x", ""]);
});

test("a patch for a row not held, or one that does not apply, makes the delta unusable", () => {
  const page = [{ id: "a", text: "x" }];
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [{ id: "z", ops: [["set", ["text"], "q"]] }] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [{ id: "a", ops: [["append", ["gone"], "q"]] }] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [{ id: "a", ops: [["set", ["text"], "q"]] }], rowOrder: [] }), null, "a patched row the order drops");
});

test("a stretch is a start and a count: a window that slid by one row keeps every row it still holds", () => {
  // What bb 0.50.1's computeThreadTimelineDelta writes when rows a..e become b,c,d,e,f with c changed: the stretch
  // [1, 4] is four rows from index 1 (b to e), then the new row's id.
  const page = ["a", "b", "c", "d", "e"].map((id) => ({ id, text: id }));
  const out = applyDelta(page, {
    upsertRows: [{ id: "f", text: "f" }],
    patchRows: [{ id: "c", ops: [["append", ["text"], "!"]] }],
    rowOrder: [[1, 4], "f"],
  });
  assert.deepEqual(out?.map((x) => x.id + ":" + x.text), ["b:b", "c:c!", "d:d", "e:e", "f:f"]);
});

test("a stretch in the middle of the page, and two stretches that skip a row between them", () => {
  const page = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
  assert.deepEqual(applyDelta(page, { upsertRows: [], rowOrder: [[1, 3]] })?.map((x) => x.id), ["b", "c", "d"]);
  assert.deepEqual(applyDelta(page, { upsertRows: [], rowOrder: [[0, 2], [3, 2]] })?.map((x) => x.id), ["a", "b", "d", "e"]);
});

test("prototype keys are plain keys of the row, and the prototype is never read or changed", () => {
  const row = patchRow({ id: "a", kind: "k", text: "x" }, [["set", ["__proto__"], "p"], ["set", ["constructor"], "c"], ["set", ["prototype"], "q"]])!;
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.equal(Object.hasOwn(row, "__proto__"), true);
  assert.equal((row as Record<string, unknown>).constructor, "c");
  assert.equal(({} as Record<string, unknown>).prototype, undefined);
  assert.equal(patchRow({ id: "a", kind: "k" }, [["append", ["constructor"], "!"]]), null, "an inherited member is not a string to append to");
  assert.equal(patchRow({ id: "a", kind: "k" }, [["delete", ["toString"]]]), null, "an inherited member is not a key to delete");
  assert.equal(patchRow({ id: "a", kind: "k" }, [["set", ["__proto__", "x"], 1]]), null, "the prototype is not a node to set through");
  assert.equal(({} as Record<string, unknown>).x, undefined);
});

test("every patched or upserted row is placed exactly once", () => {
  const page = [{ id: "a", text: "x" }, { id: "b", text: "y" }, { id: "c", text: "z" }];
  const patchRows = [{ id: "b", ops: [["append", ["text"], "!"]] as RowOp[] }];
  assert.equal(applyDelta(page, { upsertRows: [], patchRows, rowOrder: [[0, 2], [1, 2]] }), null, "a patched row in two stretches");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows, rowOrder: [[0, 1], [2, 1]] }), null, "a patched row left out");
  assert.equal(applyDelta(page, { upsertRows: [{ id: "n", text: "" }], rowOrder: [[0, 3], "n", "n"] }), null, "a new row twice");
  assert.equal(applyDelta(page, { upsertRows: [{ id: "n", text: "" }, { id: "n", text: "2" }], rowOrder: [[0, 3], "n"] }), null, "two upserts of one id");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patchRows[0]!, patchRows[0]!] }), null, "two patches of one id");
});

const msg = (id: string, seq: number, role: "user" | "assistant", text: string, turnId: string | null = null) =>
  ({ id, kind: "conversation", role, text, sourceSeqStart: seq, turnId }) as unknown as Row;
const turn = (id: string, seq: number, turnId: string, status: string, children: Row[] | null = null) =>
  ({ id, kind: "turn", sourceSeqStart: seq, turnId, status, children }) as unknown as Row;
const work = (id: string, seq: number, turnId: string) => ({ id, kind: "work", sourceSeqStart: seq, turnId }) as unknown as Row;

test("a turn's children follow it when the page is flattened", () => {
  const rows = flatten([msg("u", 1, "user", "hi"), turn("t", 2, "t1", "pending", [work("w1", 3, "t1"), work("w2", 4, "t1")])]);
  assert.deepEqual(rows.map((x) => x.id), ["u", "t", "w1", "w2"]);
});

test("a refetch keeps older rows, takes the page, and drops rows the page rewrote", () => {
  const held = [msg("a", 1, "user", "x"), msg("b", 10, "assistant", "y"), msg("gone", 11, "assistant", "z")];
  const fresh = [msg("b", 10, "assistant", "y2"), msg("c", 12, "assistant", "w")];
  assert.deepEqual(mergeNewest(held, fresh).map((x) => x.id), ["a", "b", "c"]);
});

test("an older page goes before the held rows, and a row both hold is kept once", () => {
  const held = [msg("b", 10, "assistant", "y")];
  assert.deepEqual(prependOlder(held, [msg("a", 1, "user", "x"), msg("b", 10, "assistant", "y")]).map((x) => x.id), ["a", "b"]);
});

test("a live turn's tool rows are lines, and fold to nothing when the turn is done", () => {
  const memo: Memo = new Map();
  const live = itemsOf([msg("u", 1, "user", "hi"), turn("t", 2, "t1", "pending"), work("w", 3, "t1")], memo);
  assert.equal(live.find((i) => i.id === "w")!.h > 0, true);
  const done = itemsOf([msg("u", 1, "user", "hi"), turn("t", 2, "t1", "completed"), work("w", 3, "t1")], memo);
  assert.equal(done.find((i) => i.id === "w")!.h, 0);
});

test("a longer text is a new estimate, an unchanged one is the same item", () => {
  const memo: Memo = new Map();
  const first = itemsOf([msg("a", 1, "assistant", "short")], memo)[0]!;
  assert.equal(itemsOf([msg("a", 1, "assistant", "short")], memo)[0], first);
  assert.ok(itemsOf([msg("a", 1, "assistant", "long ".repeat(400))], memo)[0]!.h > first.h);
});

import { firstLine } from "./rows.ts";

test("a preview is the first line that says something, without Markdown marks, cut to fit", () => {
  assert.equal(firstLine("\n\n## **Fix** the `build`\nmore"), "Fix the build");
  assert.equal(firstLine("> - quoted item"), "quoted item");
  assert.equal(firstLine("   \n \n"), "");
  const long = firstLine("x".repeat(500));
  assert.equal(long.length, 90);
  assert.ok(long.endsWith("…"));
});

test("messages carry a preview and tool rows do not", () => {
  const memo: Memo = new Map();
  const items = itemsOf([msg("u", 1, "user", "Please fix the build"), msg("a", 2, "assistant", "On it."), work("w", 3, "t1")], memo);
  assert.equal(items[0]!.tip, "Please fix the build");
  assert.equal(items[1]!.tip, "On it.");
  assert.equal(items[2]!.tip, undefined);
});

test("work rows are named as BB names them, and a turn by its steps", () => {
  const memo: Memo = new Map();
  const ran = { ...work("w", 3, "t1"), status: "completed", presentation: { label: { pending: "Running command", completed: "Ran command" }, title: "pnpm test" } };
  const going = { ...work("x", 4, "t1"), status: "pending", presentation: { label: { pending: "Running command", completed: "Ran command" }, title: "pnpm test" } };
  const t = { ...turn("t", 2, "t1", "completed"), summaryCount: 3 };
  const items = itemsOf([ran, going, t] as never, memo);
  assert.deepEqual([items[0]!.label, items[0]!.tip], ["Ran command", "pnpm test"]);
  assert.equal(items[1]!.label, "Running command");
  assert.deepEqual([items[2]!.label, items[2]!.tip], ["Worked", "3 steps"]);
});

import { moreLines } from "./rows.ts";
test("moreLines joins the first lines that say something, without Markdown marks, and cuts the end", () => {
  assert.equal(moreLines("\n## **Fix** the `build`\n\n- then ship\n"), "Fix the build then ship");
  assert.equal(moreLines("   \n"), "");
  const long = moreLines(("word ".repeat(30) + "\n").repeat(5));
  assert.ok(long.length <= 420 && long.endsWith("…"));
});
