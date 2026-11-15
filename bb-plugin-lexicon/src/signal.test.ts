import test from "node:test";
import assert from "node:assert/strict";
import { concerns, readChanged } from "./signal.ts";

test("a signal carries a project or null, and nothing else is read", () => {
  assert.deepEqual(readChanged({ projectId: "p1" }), { projectId: "p1" });
  assert.deepEqual(readChanged({ projectId: null }), { projectId: null });
  for (const bad of [undefined, null, "p1", 3, {}, { projectId: 4 }]) assert.equal(readChanged(bad), null);
});

test("a signal for no project concerns every project; otherwise only its own", () => {
  assert.equal(concerns({ projectId: null }, "p2"), true);
  assert.equal(concerns({ projectId: "p1" }, "p1"), true);
  assert.equal(concerns({ projectId: "p1" }, "p2"), false);
});
