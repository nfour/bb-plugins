import assert from "node:assert/strict";
import { test } from "node:test";
import { FAR, isJump, planLines, windowStart } from "./window.ts";

test("windowStart puts the pointer's row in the middle and moves inward at both ends", () => {
  assert.equal(windowStart(10, 1, 100), 9);
  assert.equal(windowStart(0, 1, 100), 0);
  assert.equal(windowStart(99, 1, 100), 97);
  assert.equal(windowStart(50, 0, 100), 50);
  assert.equal(windowStart(50, 6, 100), 44);
  assert.equal(windowStart(99, 0, 100), 99);
});

test("windowStart never leaves part of the window empty, however few rows are drawn", () => {
  for (const context of [0, 1, 2, 6]) {
    const span = 2 * context + 1;
    for (const drawn of [1, 2, 3, 7, 30, 500]) {
      for (let place = 0; place < drawn; place++) {
        const start = windowStart(place, context, drawn);
        assert.ok(start >= 0);
        // The window covers the row (or the thread is shorter than the window).
        assert.ok(start <= place && (place < start + span || drawn < span), `place ${place} context ${context} drawn ${drawn} start ${start}`);
        // And it ends within the rows, unless there are fewer rows than slots.
        assert.ok(start + Math.min(span, drawn) <= drawn);
      }
    }
  }
});

test("planLines builds the lines a move passes and keeps the held ones on the way", () => {
  const plan = planLines([10, 11, 12], 10, 14, 3, 100);
  assert.deepEqual(plan.drop, []);
  assert.deepEqual(plan.refresh, [10, 11, 12]);
  assert.deepEqual(plan.build, [13, 14, 15, 16]);
});

test("planLines works the same moving up", () => {
  const plan = planLines([20, 21, 22], 20, 15, 3, 100);
  assert.deepEqual(plan.build, [15, 16, 17, 18, 19]);
  assert.deepEqual(plan.refresh, [20, 21, 22]);
});

test("planLines drops lines far from the move and those past the end of the rows", () => {
  const plan = planLines([0, 1, 60, 98, 99], 60, 61, 3, 99);
  // Lines within FAR of the move's reach are kept; 0 and 1 are 59 away, 98 is 36 away, and 99 is no longer a row.
  assert.deepEqual(plan.drop.sort((a, b) => a - b), [0, 1, 98, 99]);
  assert.ok(plan.refresh.includes(60));
  assert.ok(!plan.build.includes(60));
});

test("planLines never builds a line outside the rows, at either end", () => {
  for (const [from, to] of [[0, 0], [0, 3], [97, 99], [99, 99], [5, 0]] as const) {
    const plan = planLines([], from, to, 7, 100);
    for (const place of plan.build) assert.ok(place >= 0 && place < 100, `${from}->${to}: ${place}`);
  }
  assert.deepEqual(planLines([], 0, 0, 3, 0).build, []);
  assert.deepEqual(planLines([], 0, 0, 3, 2).build, [0, 1]);
});

test("a sweep of hops of FAR rows or fewer keeps the lines it needs and the held set stays bounded", () => {
  const held = new Set<number>();
  let pos = NaN;
  const drawn = 600;
  const span = 3;
  for (let step = 0; step < 200; step++) {
    const place = (step * (FAR - 1)) % drawn;
    const start = windowStart(place, 1, drawn);
    const jump = isJump(start, pos, true);
    if (jump) held.clear();
    const plan = planLines(held, jump ? start : pos, start, span, drawn);
    for (const p of plan.drop) held.delete(p);
    for (const p of plan.build) held.add(p);
    // The window's own lines are always there once the move is planned: no blank window.
    for (let p = start; p < start + span; p++) assert.ok(held.has(p), `step ${step}: line ${p} missing`);
    // Only lines near the move are kept.
    assert.ok(held.size <= 2 * FAR + 2 * span + FAR, `held ${held.size}`);
    pos = start;
  }
});

test("isJump: a long hop, the first show or animation off jumps; a short hop glides", () => {
  assert.equal(isJump(10, NaN, true), true);
  assert.equal(isJump(10, 9, true), false);
  assert.equal(isJump(10, 10 - FAR, true), false);
  assert.equal(isJump(10 + FAR + 1, 10, true), true);
  assert.equal(isJump(10, 9, false), true);
});
