import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MAX_THREADS, forgetAll, recall, remember } from "./remember.ts";

const memory = (n: number, columnWidth = 700) => ({ columnWidth, cache: new Map(Array.from({ length: n }, (_, i) => [`r${i}`, { h: 10, w: 1 }] as const)) });

beforeEach(forgetAll);

test("what a thread's strip learned comes back, as a copy", () => {
  const m = memory(3);
  remember("a", m);
  m.cache.clear();
  assert.equal(recall("a")?.cache.size, 3);
  assert.equal(recall("a")?.columnWidth, 700);
});

test("a thread that measured nothing is not kept", () => {
  remember("a", memory(0));
  assert.equal(recall("a"), undefined);
});

test("only the most recent threads are kept", () => {
  for (let i = 0; i < MAX_THREADS + 2; i++) remember("t" + i, memory(1));
  assert.equal(recall("t0"), undefined);
  assert.equal(recall("t1"), undefined);
  assert.ok(recall("t2"));
  assert.ok(recall("t" + (MAX_THREADS + 1)));
});

test("keeping a thread again makes it the newest", () => {
  for (let i = 0; i < MAX_THREADS; i++) remember("t" + i, memory(1));
  remember("t0", memory(2));
  remember("new", memory(1));
  assert.equal(recall("t1"), undefined);
  assert.equal(recall("t0")?.cache.size, 2);
});
