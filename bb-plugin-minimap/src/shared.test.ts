import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKS, COLOR_KEYS, NUMBER_KEYS, NUMBER_RANGES, SETTINGS, SETTING_KEYS, readNumber } from "./shared.ts";

test("every setting is exactly one of on/off, number or colour", () => {
  const all = [...SETTING_KEYS, ...NUMBER_KEYS, ...COLOR_KEYS].sort();
  assert.deepEqual(all, Object.keys(SETTINGS).sort());
});

test("every number's default is inside its own range", () => {
  for (const key of NUMBER_KEYS) {
    const [min, max] = NUMBER_RANGES[key];
    assert.ok(min < max && SETTINGS[key].default >= min && SETTINGS[key].default <= max, key);
  }
});

test("every kind of rectangle has a show switch and a colour with the names the panel expects", () => {
  for (const { kind } of BLOCKS) {
    const word = kind[0]!.toUpperCase() + kind.slice(1);
    assert.equal((SETTINGS as Record<string, { type: string }>)[`show${word}`]?.type, "boolean", kind);
    assert.equal((SETTINGS as Record<string, { type: string }>)[`color${word}`]?.type, "string", kind);
  }
});

test("a number read is rounded, held to its range, and falls back to its default", () => {
  assert.equal(readNumber({ width: 40.6 }, "width"), 41);
  assert.equal(readNumber({ width: 1 }, "width"), 6);
  assert.equal(readNumber({ width: 9999 }, "width"), 120);
  assert.equal(readNumber({ width: "wide" }, "width"), 26);
  assert.equal(readNumber({ width: Number.NaN }, "width"), 26);
  assert.equal(readNumber(undefined, "narrowWidth"), 12);
});

test("the defaults are the ones the owner settled on", () => {
  assert.deepEqual(
    { w: SETTINGS.width.default, o: SETTINGS.opacity.default, i: SETTINGS.idleOpacity.default, so: SETTINGS.sliderOpacity.default, st: SETTINGS.sliderThickness.default },
    { w: 26, o: 66, i: 33, so: 26, st: 2 },
  );
  assert.equal(SETTINGS.hideScrollbar.default, true);
  assert.equal(SETTINGS.fadeIdle.default, true);
  assert.equal(SETTINGS.hoverPreview.default, true);
});
