import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { refresher, refreshes } from "./refresh.ts";

test("a file written, reverted or discarded, and a commit, all refresh the list", () => {
  assert.ok(refreshes(["work-status-changed"]), "the working tree changed");
  assert.ok(refreshes(["git-refs-changed"]), "a commit");
  assert.ok(refreshes(["thread-storage-changed", "work-status-changed"]));
  assert.ok(!refreshes(["thread-storage-changed"]));
  assert.ok(!refreshes(["diff-viewed-changed"]));
  assert.ok(!refreshes([]));
});

test("refresher waits for quiet", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let runs = 0;
  const r = refresher(() => runs++, 1000, 5000);
  r.signal();
  t.mock.timers.tick(600);
  r.signal();
  t.mock.timers.tick(600);
  assert.equal(runs, 0, "the second signal moved it back");
  t.mock.timers.tick(400);
  assert.equal(runs, 1);
  t.mock.timers.tick(10000);
  assert.equal(runs, 1);
});

test("refresher still runs while signals never stop", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let runs = 0;
  const r = refresher(() => runs++, 1000, 5000);
  for (let i = 0; i < 30; i++) {
    r.signal();
    t.mock.timers.tick(500);
  }
  assert.ok(runs >= 2, `ran ${runs} times in 15s of steady writing`);
  assert.ok(runs <= 4);
});

test("refresher can be cancelled", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let runs = 0;
  const r = refresher(() => runs++, 1000, 5000);
  r.signal();
  r.cancel();
  t.mock.timers.tick(10000);
  assert.equal(runs, 0);
  void mock;
});
