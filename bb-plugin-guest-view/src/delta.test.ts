import assert from "node:assert/strict";
import { test } from "node:test";
import { applyDelta, emptyHeld, FULL_EVERY_MS, readHeld, type TimelineRead } from "./delta.ts";

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

test("a stretch out of range, an id nowhere or an upsert with no place cannot be applied", () => {
  const page = [r("a"), r("b")];
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[0, 3]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: [[2, 1]] }), null);
  assert.equal(applyDelta(page, { upsertRows: [], rowOrder: ["nope"] }), null);
  assert.equal(applyDelta(page, { upsertRows: [r("c")], rowOrder: [[0, 2]] }), null, "a row would be lost");
});

// A fake timeline: a page of rows with a tag, and deltas against the tags it handed out.
function fakeServer() {
  let rows = [r("a"), r("b")];
  let version = 1;
  const asked: (string | undefined)[] = [];
  const mode = { answerWholeToDelta: false, badDelta: false, older: false };
  const read = async (afterTag?: string): Promise<TimelineRead<{ id: string; v: string }>> => {
    asked.push(afterTag);
    const tag = `t${version}`;
    const timelinePage = { olderCursor: mode.older ? { anchorId: "x" } : null };
    if (afterTag && !mode.answerWholeToDelta) {
      return mode.badDelta ? { tag, delta: { upsertRows: [], rowOrder: [[0, 99]] } } : { tag, delta: { upsertRows: [rows[rows.length - 1]!], rowOrder: [[0, rows.length - 1], rows[rows.length - 1]!.id], fields: { timelinePage } } };
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
  };
}

test("the first read is whole, the next ones are deltas against its tag", async () => {
  const s = fakeServer();
  const held = emptyHeld<{ id: string; v: string }>();
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

test("a page held for a minute is read whole again", async () => {
  const s = fakeServer();
  const held = emptyHeld<{ id: string; v: string }>();
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
  const held = emptyHeld<{ id: string; v: string }>();
  await readHeld(held, s.read);
  s.mode.badDelta = true;
  s.push("c");
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  assert.deepEqual(s.asked.slice(-2), ["t1", undefined]);
});

test("a whole page answered to a delta request is taken as it is", async () => {
  const s = fakeServer();
  const held = emptyHeld<{ id: string; v: string }>();
  await readHeld(held, s.read);
  s.mode.answerWholeToDelta = true;
  s.push("c");
  assert.deepEqual(await readHeld(held, s.read), { delta: false });
  assert.deepEqual(ids(held.rows), ["a", "b", "c"]);
  assert.equal(s.asked.length, 2, "one read, not two");
});

test("a failed read leaves the held page and its tag as they were", async () => {
  const s = fakeServer();
  const held = emptyHeld<{ id: string; v: string }>();
  await readHeld(held, s.read);
  await assert.rejects(readHeld(held, async () => Promise.reject(new Error("down"))), /down/);
  assert.deepEqual(ids(held.rows), ["a", "b"]);
  assert.equal(held.tag, "t1");
});

test("whether older rows exist follows the page, whole or delta", async () => {
  const s = fakeServer();
  const held = emptyHeld<{ id: string; v: string }>();
  s.mode.older = true;
  await readHeld(held, s.read);
  assert.equal(held.older, true);
  s.mode.older = false;
  s.push("c");
  await readHeld(held, s.read);
  assert.equal(held.older, false, "the delta carries the page's cursor");
});

test("a read with no tag in the answer is never followed by a delta request", async () => {
  const held = emptyHeld<{ id: string; v: string }>();
  const asked: (string | undefined)[] = [];
  const read = async (afterTag?: string): Promise<TimelineRead<{ id: string; v: string }>> => {
    asked.push(afterTag);
    return { rows: [r("a")] };
  };
  await readHeld(held, read);
  await readHeld(held, read);
  assert.deepEqual(asked, [undefined, undefined]);
});
