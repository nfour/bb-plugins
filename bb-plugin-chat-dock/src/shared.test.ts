import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, definitions, menuLabel, SETTING_KEYS, SETTINGS } from "./shared.ts";

test("the keys are the list's keys, each a boolean with a label and a description", () => {
  assert.deepEqual([...SETTING_KEYS].sort(), Object.keys(SETTINGS).sort());
  for (const key of SETTING_KEYS) {
    assert.equal(SETTINGS[key].type, "boolean", key);
    assert.ok(SETTINGS[key].label.length > 0 && SETTINGS[key].description.length > 0, key);
  }
});

test("the defaults are the ones every saved setting was made against", () => {
  assert.deepEqual(DEFAULTS, { enabled: true, locked: true, showButton: true, debugLog: false });
});

test("the thread menu lists the settings in the list's order, by their short label where there is one", () => {
  assert.deepEqual(SETTING_KEYS.map(menuLabel), [
    "Dock the composer in the right panel",
    "Keep it at the panel's bottom",
    "Dock button in the composer",
    "Debug log",
  ]);
});

test("what the backend hands BB is the list less what only the page uses", () => {
  const defined = definitions();
  assert.deepEqual(Object.keys(defined), [...SETTING_KEYS]);
  for (const key of SETTING_KEYS) {
    assert.deepEqual(Object.keys(defined[key]).sort(), ["default", "description", "label", "type"], key);
    assert.equal(defined[key].default, DEFAULTS[key], key);
    assert.equal(defined[key].label, SETTINGS[key].label, key);
  }
});
