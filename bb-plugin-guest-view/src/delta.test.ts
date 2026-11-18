import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta, emptyHeld, FULL_EVERY_MS, patchRow, readHeld, type PatchOp, type RowOrder, type RowPatch, type TimelineRead } from "./delta.ts";

interface Row {
  id: string;
  kind: string;
  text?: string;
  [key: string]: unknown;
}
const r = (id: string, text = ""): Row => ({ id, kind: "message", text });
const ids = (rows: Row[] | null) => rows?.map((x) => x.id + (x.text ?? ""));

// ─── applyDelta ──────────────────────────────────────────────────────────────

test("a delta without an order replaces rows where they are", () => {
  assert.deepEqual(ids(applyDelta([r("a"), r("b")], { upsertRows: [r("b", "!")] })), ["a", "b!"]);
});

test("a delta without an order cannot add a row it does not place", () => {
  assert.equal(applyDelta([r("a")], { upsertRows: [r("z")] }), null);
});

test("an order of stretches and new ids rebuilds the page; a stretch is [start, count]", () => {
  const page = [r("a"), r("b"), r("c")];
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [r("d")], rowOrder: [[0, 3], "d"] })), ["a", "b", "c", "d"]);
  // The window slid: the oldest row left and one came. This is what bb sends, and a start of 1 with a count of 2 is b, c.
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [r("d")], rowOrder: [[1, 2], "d"] })), ["b", "c", "d"]);
  // Rows removed from the middle leave two stretches.
  const five = [r("a"), r("b"), r("c"), r("d"), r("e")];
  assert.deepEqual(ids(applyDelta(five, { upsertRows: [], rowOrder: [[0, 1], [2, 3]] })), ["a", "c", "d", "e"]);
  // A row replaced as a whole (an upsert of a held id is placed by its stretch).
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [r("c", "!")], rowOrder: [[0, 3]] })), ["a", "b", "c!"]);
});

test("a stretch out of range, an id that is not an upsert, or an upsert with no place cannot be applied", () => {
  const page = [r("a"), r("b")];
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 3]] }), null, "past the end");
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[2, 1]] }), null, "starts past the end");
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 0]] }), null, "an empty stretch is not a thing bb sends");
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[-1, 1]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["nope"] }), null, "a new id with no row");
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["a"] }), null, "a held id is a stretch, not a name");
  assert.equal(applyDelta(page, { upsertRows: [r("c")], rowOrder: [[0, 2]] }), null, "a row would be lost");
});

// ─── patchRow ────────────────────────────────────────────────────────────────

const row = (): Row => ({ id: "m", kind: "message", text: "Hello", parts: [{ text: "a" }, { text: "b" }], meta: { tags: ["x"], note: "n" } });
const patched = (ops: PatchOp[]) => patchRow(row(), ops);

test("append, set and delete change the row at their path", () => {
  assert.equal(patched([["append", ["text"], ", world"]])!.text, "Hello, world");
  assert.equal(patched([["set", ["text"], "Hi"]])!.text, "Hi");
  assert.equal("note" in (patched([["delete", ["meta", "note"]]])!.meta as object), false);
  assert.deepEqual(patched([["set", ["extra"], 1]])!.extra, 1, "set makes a key of the row");
});

test("paths go through objects and arrays, and a set at the end of an array adds an element", () => {
  assert.equal((patched([["append", ["parts", 1, "text"], "!"]])!.parts as Row[])[1]!.text, "b!");
  assert.deepEqual(patched([["set", ["parts", 2], { text: "c" }]])!.parts, [{ text: "a" }, { text: "b" }, { text: "c" }]);
  assert.deepEqual((patched([["set", ["meta", "tags", 1], "y"]])!.meta as { tags: string[] }).tags, ["x", "y"]);
  assert.equal((patched([["set", ["meta", "deep"], { a: { b: 1 } }]])!.meta as { deep: unknown }).deep !== undefined, true);
});

test("ops apply in order, each on what the one before left", () => {
  const out = patched([
    ["append", ["text"], " there"],
    ["append", ["text"], "!"],
    ["set", ["meta", "note"], "m"],
    ["append", ["meta", "note"], "ore"],
  ])!;
  assert.equal(out.text, "Hello there!");
  assert.equal((out.meta as { note: string }).note, "more");
});

test("a patch never changes the held row or what it shares with it", () => {
  const held = row();
  const copy = JSON.stringify(held);
  const parts = held.parts;
  const meta = held.meta;
  const out = patchRow(held, [["append", ["text"], "!"], ["append", ["parts", 0, "text"], "!"], ["set", ["meta", "note"], "z"], ["delete", ["meta", "tags"]]])!;
  assert.equal(JSON.stringify(held), copy, "the held row is as it was");
  assert.equal(held.parts, parts);
  assert.equal(held.meta, meta);
  assert.notEqual(out, held);
  assert.notEqual(out.parts, held.parts);
  assert.equal((out.parts as Row[])[1], (held.parts as Row[])[1], "what was not touched is shared, not copied");
});

test("a patch that does not fit the row gives null", () => {
  assert.equal(patched([["append", ["parts"], "x"]]), null, "append to something that is not a string");
  assert.equal(patched([["append", ["missing"], "x"]]), null, "append to nothing");
  assert.equal(patched([["set", ["nowhere", "deeper"], 1]]), null, "a path whose middle is not there");
  assert.equal(patched([["set", ["text", "x"], 1]]), null, "a path through a string");
  assert.equal(patched([["delete", ["missing"]]]), null, "delete of what is not there");
  assert.equal(patched([["delete", ["parts", 0]]]), null, "delete of an array element, which bb never sends");
  assert.equal(patched([["set", ["parts", 5], 1]]), null, "an index past the end of the array");
  assert.equal(patched([["set", ["parts", -1], 1]]), null);
  assert.equal(patched([["set", ["parts", 1.5], 1]]), null);
  assert.equal(patched([["set", ["parts", "x"], 1]]), null, "a name where an index belongs");
  assert.equal(patched([["set", ["meta", 0], 1]]), null, "an index where a name belongs");
  assert.equal(patched([["set", [], 1]]), null, "an empty path");
  assert.equal(patched([["rename", ["text"], "x"] as unknown as PatchOp]), null, "an op of another kind");
  assert.equal(patched([["append", ["text"], 5 as unknown as string]]), null, "an append of a non-string");
  assert.equal(patched([["set", ["id"], "other"]]), null, "a patch that makes it another row");
  assert.equal(patched([["set", ["kind"], "tool"]]), null, "or another kind");
  assert.equal(patched([["delete", ["id"]]]), null);
});

test("a key named like a prototype member is a plain own key: followed when the row has it, missing when it does not", () => {
  // JSON.parse makes `__proto__` an own key, as a row from bb's JSON has it.
  const odd = JSON.parse('{"id":"m","kind":"message","constructor":{"name":"n"},"prototype":{"a":"x"},"__proto__":{"text":"p"}}') as Row;
  const out = patchRow(odd, [["append", ["constructor", "name"], "!"], ["append", ["prototype", "a"], "y"], ["append", ["__proto__", "text"], "q"], ["set", ["__proto__", "more"], 1]])!;
  assert.equal((out.constructor as unknown as { name: string }).name, "n!");
  assert.deepEqual(out.prototype, { a: "xy" });
  assert.deepEqual(Object.getOwnPropertyDescriptor(out, "__proto__")!.value, { text: "pq", more: 1 }, "an own key, not the prototype");
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepEqual(odd.prototype, { a: "x" }, "the held row is as it was");
  assert.equal(patchRow(row(), [["set", ["constructor", "name"], "x"]]), null, "a row without it: missing, not the prototype's");
  assert.equal(patchRow(row(), [["delete", ["constructor"]]]), null);
  assert.equal(patchRow(row(), [["append", ["prototype", "a"], "x"]]), null);
  assert.equal(patchRow(row(), [["delete", ["__proto__"]]]), null);
  assert.equal(patchRow(row(), [["set", ["__proto__", "x"], 1]]), null, "a path through the prototype is not made into an own key");
});

test("the prototype is not reachable and not changed by a patch", () => {
  assert.equal(patched([["append", ["__proto__", "x"], "y"]]), null);
  assert.equal(patched([["set", ["toString", "x"], 1]]), null, "a name only the prototype has");
  const out = patched([["set", ["__proto__"], { polluted: true }]])!;
  assert.equal(({} as { polluted?: boolean }).polluted, undefined, "Object.prototype is untouched");
  assert.equal(Object.getPrototypeOf(out), Object.prototype, "and the row's own is as it was");
});

// ─── applyDelta with patchRows ───────────────────────────────────────────────

const patch = (id: string, ...ops: PatchOp[]): RowPatch => ({ id, ops });

test("patchRows change held rows where they are, with or without an order", () => {
  const page = [r("a", "1"), r("b", "2"), r("c", "3")];
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [], patchRows: [patch("b", ["append", ["text"], "!"])] })), ["a1", "b2!", "c3"]);
  assert.deepEqual(ids(applyDelta(page, { upsertRows: [r("d", "4")], patchRows: [patch("c", ["set", ["text"], "three"])], rowOrder: [[0, 3], "d"] })), ["a1", "b2", "cthree", "d4"]);
  assert.deepEqual(page.map((x) => x.text), ["1", "2", "3"], "the held page is as it was");
});

test("a slid window with a patched row: what bb sends for it comes out right", () => {
  // Found against bb 0.50.1's own encoder: a..e become b..f with c changed -> rowOrder [[1,4],"f"], patchRows [c].
  const page = ["a", "b", "c", "d", "e"].map((id) => r(id, id));
  const out = applyDelta(page, { upsertRows: [r("f", "f")], patchRows: [patch("c", ["append", ["text"], "!"])], rowOrder: [[1, 4], "f"] });
  assert.deepEqual(ids(out), ["bb", "cc!", "dd", "ee", "ff"]);
});

test("an id named twice among the upserts or the patches cannot be applied", () => {
  const page = [r("a", "1"), r("b", "2")];
  assert.equal(applyDelta(page, { upsertRows: [r("c", "x"), r("c", "y")], rowOrder: [[0, 2], "c"] }), null, "two upserts of one new row");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patch("a", ["append", ["text"], "x"]), patch("a", ["append", ["text"], "y"])] }), null, "two patches of one row");
  assert.equal(applyDelta(page, { upsertRows: [r("b", "x"), r("b", "y")] }), null, "two whole rows for one held row");
});

test("a delta whose patches or upserts are not each placed exactly once cannot be applied", () => {
  const page = [r("a"), r("b"), r("c")];
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patch("zzz", ["set", ["text"], "x"])] }), null, "a patch for a row not held");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patch("a", ["delete", ["missing"]])] }), null, "a patch that does not apply");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patch("c", ["set", ["text"], "x"])], rowOrder: [[0, 2]] }), null, "the patched row was dropped from the order");
  assert.equal(applyDelta(page, { upsertRows: [], patchRows: [patch("a", ["set", ["text"], "x"])], rowOrder: [[0, 3], [0, 1]] }), null, "a row placed twice");
  assert.equal(applyDelta(page, { upsertRows: [r("a", "whole")], patchRows: [patch("a", ["set", ["text"], "x"])] }), null, "the same row twice, whole and patched");
});

// ─── The encoder, mirrored: any history of a page gives back its newest rows ─

/** What bb's `computeThreadTimelineDelta` does (server-contract, bb 0.50), written out here so a change in either shows. */
function diff(before: unknown, after: unknown, path: (string | number)[], ops: PatchOp[]) {
  if (before === after) return;
  if (typeof before === "string" && typeof after === "string") {
    ops.push(before.length > 0 && after.startsWith(before) ? ["append", path, after.slice(before.length)] : ["set", path, after]);
    return;
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    if (after.length < before.length) return void ops.push(["set", path, after]);
    after.forEach((value, i) => (i < before.length ? diff(before[i], value, [...path, i], ops) : ops.push(["set", [...path, i], value])));
    return;
  }
  const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    for (const [key, value] of Object.entries(before)) if (value !== undefined && after[key] === undefined) ops.push(["delete", [...path, key]]);
    for (const [key, value] of Object.entries(after)) {
      if (value === undefined) continue;
      if (before[key] === undefined) ops.push(["set", [...path, key], value]);
      else diff(before[key], value, [...path, key], ops);
    }
    return;
  }
  ops.push(["set", path, after]);
}
function encode(previous: Row[], current: Row[]) {
  const index = new Map(previous.map((row, i) => [row.id, i]));
  const upsertRows: Row[] = [];
  const patchRows: RowPatch[] = [];
  for (const row of current) {
    const before = index.has(row.id) ? previous[index.get(row.id)!] : undefined;
    if (!before) upsertRows.push(row);
    else if (JSON.stringify(before) !== JSON.stringify(row)) {
      const ops: PatchOp[] = [];
      diff(before, row, [], ops);
      if (ops.length) patchRows.push({ id: row.id, ops });
    }
  }
  const order: (string | [number, number])[] = [];
  let same = previous.length === current.length;
  let run: [number, number] | null = null;
  current.forEach((row, position) => {
    const at = index.get(row.id);
    if (at !== position) same = false;
    if (at === undefined) {
      run = null;
      order.push(row.id);
    } else if (run && run[0] + run[1] === at) run[1] += 1;
    else {
      run = [at, 1];
      order.push(run);
    }
  });
  return { upsertRows, ...(patchRows.length ? { patchRows } : {}), ...(same ? {} : { rowOrder: order as RowOrder }) };
}

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [1, 2, 3, 4, 5, 6]) {
  test(`a page followed by deltas equals the page read whole, through slides, removals, streaming and rewrites (run ${seed})`, () => {
    const rand = seeded(seed);
    let next = 0;
    const fresh = (): Row => ({ id: "r" + next++, kind: rand() < 0.5 ? "message" : "work", text: "t" + next, parts: [{ text: "p" }], meta: { n: 1 } });
    let rows: Row[] = Array.from({ length: 6 }, fresh);
    let held = rows.map((x) => structuredClone(x));
    let patches = 0;
    let stretches = 0;
    for (let step = 0; step < 300; step++) {
      const before = rows;
      const roll = rand();
      rows = rows.map((x) => structuredClone(x));
      if (roll < 0.25 || rows.length < 4) rows.push(fresh());
      else if (roll < 0.4) rows.shift(); // the window slid
      else if (roll < 0.5 && rows.length > 2) rows.splice(Math.floor(rand() * rows.length), 1);
      else if (roll < 0.7) {
        const row = rows[Math.floor(rand() * rows.length)]!;
        row.text += " more"; // a streaming reply
      } else if (roll < 0.78) {
        const row = rows[Math.floor(rand() * rows.length)]!;
        row.text = "rewritten " + step; // not an append
      } else if (roll < 0.86) {
        const row = rows[Math.floor(rand() * rows.length)]!;
        (row.parts as { text: string }[]).push({ text: "q" + step });
        row.meta = { n: step, added: true };
      } else if (roll < 0.9) {
        const row = rows[Math.floor(rand() * rows.length)]!;
        delete row.meta;
        (row.parts as { text: string }[]).length = 0;
      } else if (roll < 0.95 && rows.length > 3) {
        const [one] = rows.splice(Math.floor(rand() * rows.length), 1);
        rows.splice(Math.floor(rand() * (rows.length + 1)), 0, one!); // reordered
      }
      const delta = encode(before, rows);
      if (delta.patchRows) patches += 1;
      if (delta.rowOrder?.some((entry) => typeof entry !== "string" && entry[0] > 0)) stretches += 1;
      const applied = applyDelta(held, delta);
      assert.ok(applied, `step ${step}: the delta fits what is held`);
      assert.deepEqual(applied, rows, `step ${step}: the page after the delta is the page`);
      held = applied;
    }
    assert.ok(patches > 50 && stretches > 20, "the run used patches and stretches that start past 0");
  });
}

// ─── readHeld ────────────────────────────────────────────────────────────────

// A fake timeline: a page of rows with a tag, and deltas against the tags it handed out.
function fakeServer() {
  let rows = [r("a"), r("b")];
  let version = 1;
  const asked: (string | undefined)[] = [];
  const mode: { answerWholeToDelta: boolean; badDelta: boolean; older: boolean; patch: RowPatch[] | null; afterTag: string | undefined; cursorField: Record<string, unknown> | undefined } = {
    answerWholeToDelta: false,
    badDelta: false,
    older: false,
    patch: null,
    afterTag: undefined,
    cursorField: undefined,
  };
  const read = async (afterTag?: string): Promise<TimelineRead<Row>> => {
    asked.push(afterTag);
    const tag = `t${version}`;
    const timelinePage = { olderCursor: mode.older ? { anchorId: "x" } : null };
    if (afterTag && !mode.answerWholeToDelta) {
      if (mode.badDelta) return { tag, delta: { afterTag, upsertRows: [], rowOrder: [[0, 99]] } };
      const last = rows[rows.length - 1]!;
      const fields = { timelinePage: mode.cursorField ?? timelinePage };
      if (mode.patch) return { tag, delta: { afterTag: mode.afterTag ?? afterTag, upsertRows: [], patchRows: mode.patch, fields } };
      return { tag, delta: { afterTag: mode.afterTag ?? afterTag, upsertRows: [last], rowOrder: [[0, rows.length - 1], last.id], fields } };
    }
    return { tag, rows: [...rows], timelinePage };
  };
  return {
    read,
    asked,
    mode,
    push: (id: string) => {
      rows = [...rows, r(id)];
      version += 1;
    },
    /** The next version of the page has the text of row `id` changed (and the delta says so with `mode.patch`). */
    edit: (id: string, text: string) => {
      rows = rows.map((x) => (x.id === id ? { ...x, text } : x));
      version += 1;
    },
  };
}

test("the first read is whole, the next ones are deltas against its tag", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b"]);
  s.push("c");
  assert.deepEqual(await readHeld(held, s.read), { delta: true });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  s.push("d");
  await readHeld(held, s.read);
  assert.deepEqual(ids(held.rows), ["a", "b", "c", "d"]);
  assert.deepEqual(s.asked, [undefined, "t1", "t2"], "each read names the tag of the one before");
});

test("a streaming row changes in place from a delta, with no whole read", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.edit("b", "typing");
  s.mode.patch = [patch("b", ["set", ["text"], "typing"])];
  assert.deepEqual(await readHeld(held, s.read), { delta: true });
  assert.deepEqual(ids(held.rows), ["a", "btyping"]);
  s.edit("b", "typing on");
  s.mode.patch = [patch("b", ["append", ["text"], " on"])];
  assert.deepEqual(await readHeld(held, s.read), { delta: true });
  assert.deepEqual(ids(held.rows), ["a", "btyping on"]);
  assert.deepEqual(s.asked, [undefined, "t1", "t2"], "one whole read in all");
});

test("a patch that does not fit is followed by a whole read, and the page is never half-updated", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.edit("b", "whole");
  s.mode.patch = [patch("b", ["append", ["nowhere"], "x"])];
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "bwhole"], "the whole page has the change");
  assert.deepEqual(s.asked.slice(-2), ["t1", undefined]);
  s.mode.patch = [patch("never-held", ["set", ["text"], "x"])];
  s.edit("a", "again");
  assert.deepEqual(await readHeld(held, s.read), { delta: false }, "and a patch for a row that is not held");
  assert.deepEqual(ids(held.rows), ["aagain", "bwhole"]);
});

test("a delta that names no tag is not applied either", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.push("c");
  const named = s.read;
  const unnamed = async (afterTag?: string): Promise<TimelineRead<Row>> => {
    const page = await named(afterTag);
    if ("delta" in page) delete page.delta.afterTag;
    return page;
  };
  assert.deepEqual(await readHeld(held, unnamed), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  assert.deepEqual(s.asked.slice(-2), ["t1", undefined], "a whole read followed");
});

test("a delta against another tag than the one held is not applied", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.push("c");
  s.mode.afterTag = "t999";
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
});

test("a page held for a minute is read whole again", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  let clock = 1_000;
  const now = () => clock;
  await readHeld(held, s.read, now);
  clock += FULL_EVERY_MS - 1;
  await readHeld(held, s.read, now);
  assert.equal(s.asked[1], "t1", "just under a minute: a delta");
  clock += 2;
  const third = await readHeld(held, s.read, now);
  assert.deepEqual(third, { delta: false });
  assert.equal(s.asked[2], undefined, "past a minute: a whole page");
});

test("a delta that does not fit is followed by a whole page, and the held page is never half-updated", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.mode.badDelta = true;
  s.push("c");
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  assert.deepEqual(s.asked.slice(-2), ["t1", undefined]);
});

test("a whole page answered to a delta request is taken as it is", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  s.mode.answerWholeToDelta = true;
  s.push("c");
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  assert.equal(s.asked.length, 2, "one read, not two");
});

test("a failed read leaves the held page and its tag as they were", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  await readHeld(held, s.read);
  await assert.rejects(readHeld(held, async () => Promise.reject(new Error("down"))), /down/);
  assert.deepEqual(ids(held.rows), ["a", "b"]);
  assert.equal(held.tag, "t1");
});

test("whether older rows exist follows the page's cursor, whole or delta, and only when the delta names it", async () => {
  const s = fakeServer();
  const held = emptyHeld<Row>();
  s.mode.older = true;
  await readHeld(held, s.read);
  assert.equal(held.older, true);
  s.mode.older = false;
  s.push("c");
  await readHeld(held, s.read);
  assert.equal(held.older, false, "the delta carries the page's cursor");
  s.mode.older = true;
  await readHeld(held, s.read);
  assert.equal(held.older, true);
  // A delta lists only what changed in the page's fields: no cursor named means it did not move.
  s.mode.cursorField = { returnedSegmentCount: 3 };
  s.push("d");
  await readHeld(held, s.read);
  assert.equal(held.older, true, "a patch of other fields leaves it");
  s.mode.cursorField = { olderCursor: null };
  s.push("e");
  await readHeld(held, s.read);
  assert.equal(held.older, false, "a cursor that is null is gone");
});

test("a read with no tag in the answer is never followed by a delta request", async () => {
  const held = emptyHeld<Row>();
  const asked: (string | undefined)[] = [];
  const read = async (afterTag?: string): Promise<TimelineRead<Row>> => {
    asked.push(afterTag);
    return { rows: [r("a")] };
  };
  await readHeld(held, read);
  await readHeld(held, read);
  assert.deepEqual(asked, [undefined, undefined]);
});
