import assert from "node:assert/strict";
import { test } from "node:test";
import { elapsedLabel, leftLabel, sinceLabel } from "./labels.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;

test("sinceLabel says how long a guest has been here", () => {
  assert.equal(sinceLabel(0, 30_000), "just now");
  assert.equal(sinceLabel(0, 5 * MIN), "5 min");
  assert.equal(sinceLabel(0, 59 * MIN), "59 min");
  assert.equal(sinceLabel(0, HOUR), "1 h");
  assert.equal(sinceLabel(0, HOUR + 5 * MIN), "1 h 05 min");
  assert.equal(sinceLabel(100, 0), "just now", "a clock that went backwards reads as just now");
});

test("elapsedLabel ticks by the second", () => {
  assert.equal(elapsedLabel(0, 0), "0m00s");
  assert.equal(elapsedLabel(0, 3 * MIN + 32_000), "3m32s");
  assert.equal(elapsedLabel(0, HOUR + 2 * MIN + 5_000), "1h02m05s");
  assert.equal(elapsedLabel(10_000, 0), "0m00s");
});

test("leftLabel is short", () => {
  assert.equal(leftLabel(45 * MIN, 0), "45m");
  assert.equal(leftLabel(4 * HOUR, 0), "4h");
  assert.equal(leftLabel(47 * HOUR, 0), "47h");
  assert.equal(leftLabel(50 * HOUR, 0), "2d 2h");
  assert.equal(leftLabel(72 * HOUR, 0), "3d");
  assert.equal(leftLabel(0, HOUR), "0m", "never negative");
});
