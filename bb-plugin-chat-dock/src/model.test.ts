import assert from "node:assert/strict";
import { test } from "node:test";
import { isShut, lowestIndex, paneOfPanelId, plan, type Step, type Want } from "./model.ts";

test("a panel id names its pane, the plain one and strangers name none", () => {
  assert.equal(paneOfPanelId("thread-detail-secondary-panel-pane-2"), "pane-2");
  assert.equal(paneOfPanelId("thread-detail-secondary-panel"), null);
  assert.equal(paneOfPanelId("thread-detail-secondary-panel-"), null);
  assert.equal(paneOfPanelId("something-else-pane-2"), null);
});

test("the bottom tile is the lowest one", () => {
  assert.equal(lowestIndex([]), -1);
  assert.equal(lowestIndex([{ bottom: 500, left: 0 }]), 0);
  assert.equal(lowestIndex([{ bottom: 300, left: 0 }, { bottom: 800, left: 0 }, { bottom: 500, left: 0 }]), 1);
});

test("tiles side by side: the leftmost, whatever the DOM order", () => {
  assert.equal(lowestIndex([{ bottom: 800, left: 400 }, { bottom: 800, left: 0 }]), 1);
  assert.equal(lowestIndex([{ bottom: 800, left: 0 }, { bottom: 800, left: 400 }]), 0);
});

test("a pixel of slack in the bottom edge does not make a tile lower", () => {
  // Subpixel layout: 800.4 against 800 is the same row; the leftmost wins.
  assert.equal(lowestIndex([{ bottom: 800.4, left: 400 }, { bottom: 800, left: 0 }]), 1);
  assert.equal(lowestIndex([{ bottom: 800, left: 400 }, { bottom: 800.9, left: 0 }]), 1);
  // Two pixels is a lower row, however far left the other is.
  assert.equal(lowestIndex([{ bottom: 802, left: 400 }, { bottom: 800, left: 0 }]), 0);
});

test("a tile that is lower by more than the slack beats a leftmost one above it", () => {
  assert.equal(lowestIndex([{ bottom: 400, left: 0 }, { bottom: 800, left: 500 }, { bottom: 800, left: 200 }]), 2);
});

test("a panel is shut when sized to 0, inert, or concealed from assistive technology", () => {
  const open = { size: "50.0", inert: false, ariaHidden: null };
  assert.equal(isShut(open), false);
  assert.equal(isShut({ ...open, size: "0" }), true);
  assert.equal(isShut({ ...open, size: "0.0" }), true);
  assert.equal(isShut({ ...open, inert: true }), true);
  assert.equal(isShut({ ...open, ariaHidden: "true" }), true);
});

test("a panel with no size (the drawer, a panel not yet measured) is open unless something else says shut", () => {
  assert.equal(isShut({ size: undefined, inert: false, ariaHidden: null }), false);
  assert.equal(isShut({ size: "", inert: false, ariaHidden: "false" }), false);
  assert.equal(isShut({ size: "n/a", inert: false, ariaHidden: null }), false);
  assert.equal(isShut({ size: undefined, inert: true, ariaHidden: null }), true);
});

const cases: [string, Parameters<typeof plan>[0], Step][] = [
  ["nothing held, a panel that is shut: nothing", { want: "column", held: null, columnShell: true, holds: false }, "none"],
  ["a shell in the column and a panel that is open: hold it in the strip", { want: "strip", held: null, columnShell: true, holds: false }, "hold"],
  ["a shell in the column and the Chat tab mounted: hold it in the tab", { want: "tab", held: null, columnShell: true, holds: false }, "hold"],
  ["no shell yet (the column is still mounting): wait", { want: "strip", held: null, columnShell: false, holds: false }, "none"],
  ["the panel closed while the strip held it: back to the column", { want: "column", held: "strip", columnShell: false, holds: true }, "release"],
  ["the Chat tab went while it held the shell: back to the column", { want: "column", held: "tab", columnShell: false, holds: true }, "release"],
  ["the host is gone with the shell inside it: release even if there is nowhere to hold", { want: "column", held: "strip", columnShell: false, holds: false }, "release"],
  ["held in the strip and it belongs there: keep", { want: "strip", held: "strip", columnShell: false, holds: true }, "keep"],
  ["held in the tab and it belongs there: keep", { want: "tab", held: "tab", columnShell: false, holds: true }, "keep"],
  ["the lock went on while the tab held it: move to the strip, not through the column", { want: "strip", held: "tab", columnShell: false, holds: true }, "move"],
  ["the lock went off while the strip held it: move to the tab", { want: "tab", held: "strip", columnShell: false, holds: true }, "move"],
  ["the thread changed under the panel (a new shell in the column): replace the stale one", { want: "strip", held: "strip", columnShell: true, holds: true }, "replace"],
  ["the same in the tab", { want: "tab", held: "tab", columnShell: true, holds: true }, "replace"],
  ["a new shell while the other docking place holds a stale one: replace, not move", { want: "tab", held: "strip", columnShell: true, holds: true }, "replace"],
  ["the host lost its shell (BB rebuilt it) and the column has none: release", { want: "strip", held: "strip", columnShell: false, holds: false }, "release"],
  ["the host lost its shell and the column offers one: replace", { want: "strip", held: "strip", columnShell: true, holds: false }, "replace"],
  ["the lock switched while the host is empty: release rather than move nothing", { want: "tab", held: "strip", columnShell: false, holds: false }, "release"],
];

for (const [name, input, step] of cases) test(`plan: ${name}`, () => assert.equal(plan(input), step));

test("plan: a pane with nothing held and nowhere it belongs never has anything to do, whatever the column offers", () => {
  for (const columnShell of [true, false]) for (const holds of [true, false]) assert.equal(plan({ want: "column", held: null, columnShell, holds }), "none");
});

test("plan: a held shell that belongs in the column is always released", () => {
  for (const held of ["strip", "tab"] as const) for (const columnShell of [true, false]) for (const holds of [true, false]) assert.equal(plan({ want: "column", held, columnShell, holds }), "release");
});

test("plan: only a hold or a move ever puts a shell somewhere new, and only `move` skips the column", () => {
  const wants: Want[] = ["strip", "tab"];
  for (const want of wants) for (const held of [null, "strip", "tab"] as const) for (const columnShell of [true, false]) for (const holds of [true, false]) {
    const step = plan({ want, held, columnShell, holds });
    if (step === "move") assert.ok(held && held !== want && holds && !columnShell);
    if (step === "keep") assert.ok(held === want && holds && !columnShell);
    if (step === "hold") assert.ok(!held && columnShell);
  }
});
