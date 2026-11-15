import test from "node:test";
import assert from "node:assert/strict";
import { joinChunks, locate, outermost } from "./spans.ts";

const P1 = { name: "p1" };
const P2 = { name: "p2" };
const piece = (node: string, data: string, owner: object) => ({ node, data, owner });

test("pieces of one paragraph are joined, a new owner starts a new chunk, empty text is skipped", () => {
  const chunks = joinChunks([piece("a", "pinned ", P1), piece("b", "", P1), piece("c", "folders", P1), piece("d", "next", P2)]);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.text, "pinned folders");
  assert.deepEqual(chunks[0]!.nodes, [
    { node: "a", start: 0, length: 7 },
    { node: "c", start: 7, length: 7 },
  ]);
  assert.equal(chunks[0]!.owner, P1);
  assert.equal(chunks[1]!.text, "next");
});

test("the same owner met again after another one is a separate chunk: a phrase never runs across a nested paragraph", () => {
  const chunks = joinChunks([piece("a", "frozen ", P1), piece("b", "inside", P2), piece("c", "folders", P1)]);
  assert.deepEqual(chunks.map((c) => c.text), ["frozen ", "inside", "folders"]);
});

test("locate finds the nodes a match starts and ends in, with offsets in them", () => {
  const [chunk] = joinChunks([piece("a", "pinned ", P1), piece("b", "folders", P1), piece("c", " here", P1)]);
  assert.deepEqual(locate(chunk!.nodes, 0, 6), { first: "a", startOffset: 0, last: "a", endOffset: 6 });
  assert.deepEqual(locate(chunk!.nodes, 0, 14), { first: "a", startOffset: 0, last: "b", endOffset: 7 });
  assert.deepEqual(locate(chunk!.nodes, 4, 9), { first: "a", startOffset: 4, last: "b", endOffset: 2 });
  assert.deepEqual(locate(chunk!.nodes, 7, 14), { first: "b", startOffset: 0, last: "b", endOffset: 7 });
  assert.deepEqual(locate(chunk!.nodes, 8, 19), { first: "b", startOffset: 1, last: "c", endOffset: 5 });
});

test("locate refuses empty and out-of-range spans", () => {
  const [chunk] = joinChunks([piece("a", "abc", P1)]);
  assert.equal(locate(chunk!.nodes, 2, 2), null);
  assert.equal(locate(chunk!.nodes, 1, 9), null);
  assert.equal(locate(chunk!.nodes, 5, 8), null);
  assert.equal(locate([], 0, 1), null);
});

test("outermost drops paragraphs inside another dirty one and keeps unrelated ones", () => {
  const tree = { a: ["b", "c"], b: ["d"] } as Record<string, string[]>;
  const contains = (outer: string, inner: string): boolean => (tree[outer] ?? []).some((x) => x === inner || contains(x, inner));
  assert.deepEqual(outermost(["d", "b", "e"], contains), ["b", "e"]);
  assert.deepEqual(outermost(["a", "b", "c"], contains), ["a"]);
  assert.deepEqual(outermost(["c", "d"], contains), ["c", "d"]);
});
