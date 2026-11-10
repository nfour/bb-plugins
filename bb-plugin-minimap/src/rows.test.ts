import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta, flatten, itemsOf, mergeNewest, prependOlder, type Memo, type Row } from "./rows.ts";

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

test("an order may drop rows and name a held row by id", () => {
  const page = [r("a"), r("b"), r("c")];
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [], rowOrder: [[1, 3], "a"] })), ["b", "c", "a"]);
});

test("a stretch out of range, or an id nowhere, cannot be applied", () => {
  const page = [r("a"), r("b")];
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 3]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[2, 1]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["nope"] }), null);
});

test("an upsert the order never places would lose a row, so it is refused", () => {
  assert.equal(applyDelta([r("a"), r("b")], { upsertRows: [r("c")], rowOrder: [[0, 2]] }), null);
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
