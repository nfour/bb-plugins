import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NUMBERS, NUMBER_KEYS, SETTING_KEYS, SWITCHES, TABS, attributesFor, clampNumber, propertiesFor, valueOf } from "./shared.ts";

const NO_ATTRS = { "data-reply-style-guides": null, "data-reply-style-quote": null, "data-reply-style-tables": null };

test("every key has one setting, and every setting a tab", () => {
  assert.deepEqual([...SWITCHES.map((s) => s.key), ...NUMBERS.map((n) => n.key)], [...SETTING_KEYS]);
  assert.deepEqual(NUMBERS.map((n) => n.key), [...NUMBER_KEYS]);
  for (const s of [...SWITCHES, ...NUMBERS]) assert.ok(TABS.includes(s.tab), s.key);
});

test("defaults write no attribute and no property", () => {
  assert.deepEqual(attributesFor({}), NO_ATTRS);
  assert.deepEqual(attributesFor({ guides: true, spoilerQuote: false, tables: true }), NO_ATTRS);
  for (const value of Object.values(propertiesFor({}))) assert.equal(value, null);
});

test("an option off its default writes its attribute", () => {
  assert.deepEqual(attributesFor({ guides: false, spoilerQuote: true, tables: false }), {
    "data-reply-style-guides": "off",
    "data-reply-style-quote": "on",
    "data-reply-style-tables": "off",
  });
});

test("a value of the wrong type counts as the default", () => {
  assert.deepEqual(attributesFor({ guides: "no" }), NO_ATTRS);
  assert.equal(valueOf({ quoteBar: "50" }, "quoteBar"), 30);
});

test("a number off its default writes its property with its unit, clamped", () => {
  const props = propertiesFor({ quoteBar: 45, quoteWidth: 9, open: 333 });
  assert.equal(props["--reply-style-quote-bar"], "45%");
  assert.equal(props["--reply-style-quote-width"], "6px");
  assert.equal(props["--reply-style-open"], "330ms");
  assert.equal(clampNumber("hover", -5), 0);
});

test("every default sits in its range, and matches the stylesheet's fallback", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  for (const n of NUMBERS) {
    assert.ok(n.default >= n.min && n.default <= n.max, n.key);
    const uses = [...css.matchAll(new RegExp(`var\\(${n.property}, ([^)]+)\\)`, "g"))].map((m) => m[1]);
    assert.ok(uses.length > 0, `${n.property} is not used`);
    for (const fallback of uses) assert.equal(fallback, `${n.default}${n.unit}`, n.property);
  }
  for (const m of css.matchAll(/var\((--reply-style-[a-z-]+)/g)) assert.ok(NUMBERS.some((n) => n.property === m[1]), m[1]);
});
