import assert from "node:assert/strict";
import { test } from "node:test";
import { tipOf } from "./tip.ts";
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

test("a message shows its icon and its first line", () => {
  assert.deepEqual(tipOf(rows, layout, 0), { icon: "user", text: "Fix the build" });
});

test("a row without text is named, and one the data no longer holds gets its kind's icon", () => {
  assert.deepEqual(tipOf(rows, layout, 1), { icon: "tool", text: "Work" });
  const named = { items: [{ id: "w", kind: "work", h: 10, w: 1, icon: "command", label: "Ran command", tip: "pnpm test" }], rank: new Map([["w", 0]]), hasOlder: false } as unknown as Rows;
  assert.deepEqual(tipOf(named, { ...layout, ids: ["w"], kinds: ["work"] }, 0), { icon: "command", text: "pnpm test" });
  assert.deepEqual(tipOf(rows, layout, 2), { icon: "agent", text: "Agent" });
  assert.deepEqual(tipOf(null, layout, 0), { icon: "user", text: "You" });
});

test("a point on no row has no note", () => {
  assert.equal(tipOf(rows, layout, -1), null);
});
