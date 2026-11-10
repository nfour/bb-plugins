import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { clearAllPreviews, clearPreview, getPreview, setPreview } from "./preview.ts";

beforeEach(clearAllPreviews);

test("a preview is read back until it is cleared", () => {
  setPreview("width", 55);
  assert.equal(getPreview("width"), 55);
  clearPreview("width");
  assert.equal(getPreview("width"), undefined);
});

test("setting the same value, or clearing nothing, changes nothing", () => {
  setPreview("width", 55);
  const before = { ...{ w: getPreview("width") } };
  setPreview("width", 55);
  clearPreview("opacity");
  assert.deepEqual({ w: getPreview("width") }, before);
});

test("listeners hear a change once, and not a repeat", async () => {
  const { subscribePreview } = await import("./preview.ts");
  let heard = 0;
  const stop = subscribePreview(() => heard++);
  setPreview("a", 1);
  setPreview("a", 1);
  setPreview("a", 2);
  clearPreview("a");
  clearPreview("a");
  stop();
  setPreview("a", 3);
  assert.equal(heard, 3);
});
