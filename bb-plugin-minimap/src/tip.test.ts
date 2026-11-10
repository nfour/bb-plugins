import assert from "node:assert/strict";
import { test } from "node:test";
import { tipFor } from "./tip.ts";
import type { Layout } from "./model.ts";
import type { Rows } from "./timeline.ts";

const layout: Layout = { ids: ["u", "w", "gone"], kinds: ["user", "work", "reply"], y: [0, 10, 20], h: [10, 10, 10], w: [1, 1, 1], total: 30, bbs: [0], owns: [0] };
const rows = {
  items: [
    { id: "u", kind: "user", h: 10, w: 1, tip: "Fix the build" },
    { id: "w", kind: "work", h: 10, w: 1 },
  ],
  rank: new Map([["u", 0], ["w", 1]]),
  hasOlder: false,
} as unknown as Rows;

test("a message is named by its kind and its first line", () => {
  assert.equal(tipFor(rows, layout, 0), "You: Fix the build");
});

test("a row without text, or one the data no longer holds, is named by its kind alone", () => {
  assert.equal(tipFor(rows, layout, 1), "Work");
  assert.equal(tipFor(rows, layout, 2), "Agent");
  assert.equal(tipFor(null, layout, 0), "You");
});

test("a point on no row has no note", () => {
  assert.equal(tipFor(rows, layout, -1), "");
});
