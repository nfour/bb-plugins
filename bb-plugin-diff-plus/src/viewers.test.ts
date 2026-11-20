import assert from "node:assert/strict";
import { test } from "node:test";
import { createViewers } from "./viewers.ts";

test("a viewer counts until it goes", () => {
  const v = createViewers();
  assert.equal(v.has("e"), false);
  const off = v.add("e", () => true);
  assert.equal(v.has("e"), true);
  assert.equal(v.has("other"), false);
  off();
  assert.equal(v.has("e"), false);
});

test("a viewer whose tab is gone from the page does not count, though it is still registered", () => {
  const v = createViewers();
  let onPage = true;
  const off = v.add("e", () => onPage);
  assert.equal(v.has("e"), true);
  onPage = false; // a thread switch removed the tab's elements; React has not unmounted it yet
  assert.equal(v.has("e"), false);
  onPage = true;
  assert.equal(v.has("e"), true);
  off();
});

test("two tabs: the environment is showing while either is", () => {
  const v = createViewers();
  let a = true;
  const offA = v.add("e", () => a);
  const offB = v.add("e", () => true);
  a = false;
  assert.equal(v.has("e"), true);
  offB();
  assert.equal(v.has("e"), false);
  offA();
});
