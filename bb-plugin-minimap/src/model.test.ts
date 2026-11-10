import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bbOf,
  buildLayout,
  dataIdOf,
  inScrollerPixels,
  foldedHeights,
  kindOfDomId,
  ownOf,
  rectAt,
  replyHeight,
  scaleFor,
  scrollForClick,
  scrollForDrag,
  userSize,
  wrappedLines,
  type Item,
  type Measure,
  type Mounted,
} from "./model.ts";

const item = (id: string, h: number, kind: Item["kind"] = "reply", w = 1): Item => ({ id, kind, h, w });
const mounted = (id: string, rank: number | null, y: number, h: number, kind: Mounted["kind"] = "reply"): Mounted => ({ id, kind, rank, y, h, w: 1 });

test("kind of a row BB made up is read from its id", () => {
  assert.equal(kindOfDomId("t:user-seed:12"), "user");
  assert.equal(kindOfDomId("t:assistant:kind:assistant|turn:x"), "reply");
  assert.equal(kindOfDomId("t:abc-t1:turn:0"), "work");
  assert.equal(kindOfDomId("t:turn:work-summary:t:x"), "work");
  assert.equal(kindOfDomId("t:op:provider-environment:4"), "system");
});

test("a work summary stands for its first member's data id", () => {
  assert.equal(dataIdOf("t:turn1:work-summary:t:cmd:7"), "t:cmd:7");
  assert.equal(dataIdOf("t:user-seed:1"), "t:user-seed:1");
});

test("a longer text is taller and a short bubble is narrow", () => {
  assert.ok(replyHeight("word ".repeat(400)) > replyHeight("word"));
  const short = userSize("Go");
  const long = userSize("x".repeat(300));
  assert.ok(short.w < 0.2);
  assert.ok(long.w > 0.69 && long.w <= 0.7);
  assert.ok(long.h > short.h);
});

test("a very long message of yours is estimated no taller than BB shows it", () => {
  assert.equal(userSize("x".repeat(4000)).h, 380);
});

test("code in a reply is counted a line at a time, not wrapped", () => {
  assert.equal(wrappedLines("```\n" + "x".repeat(500) + "\n```", 100), 0.9);
});

test("every row is laid from the data, rows on screen at their measured height", () => {
  const items = ["a", "b", "c", "d", "e", "f"].map((id) => item(id, 100));
  // c and d are mounted at 1000-1300 in the scroller; the rest are estimates.
  const layout = buildLayout({
    items,
    mounted: [mounted("c", 2, 1000, 150), mounted("d", 3, 1150, 150)],
    cache: new Map(),
    total: 2000,
  });
  assert.deepEqual(layout.ids, ["a", "b", "c", "d", "e", "f"]);
  // Two measured rows at 150 against a guess of 100: the others are scaled by the same 1.5 once three are seen, else kept.
  assert.equal(layout.h[2], 150);
  assert.equal(layout.h[3], 150);
  assert.equal(layout.y[0], 0);
  assert.equal(layout.y[2], layout.h[0]! + layout.h[1]!);
  assert.equal(layout.total, layout.h.reduce((a, b) => a + b, 0));
});

test("the map does not move when the scroller's spacers do", () => {
  const items = ["a", "b", "c", "d", "e", "f"].map((id) => item(id, 100));
  const cache = new Map<string, Measure>();
  const one = buildLayout({ items, mounted: [mounted("c", 2, 1000, 150)], cache, total: 2000 });
  // BB re-measures: the same row now sits at 2400 in a scroller twice as tall.
  const two = buildLayout({ items, mounted: [mounted("c", 2, 2400, 150)], cache, total: 4000 });
  assert.deepEqual(two.y, one.y);
  assert.deepEqual(two.h, one.h);
  assert.equal(two.total, one.total);
});

test("scroller positions and strip positions convert both ways", () => {
  const items = ["a", "b", "c", "d"].map((id) => item(id, 100));
  const layout = buildLayout({ items, mounted: [mounted("b", 1, 600, 100), mounted("c", 2, 700, 100)], cache: new Map(), total: 1000 });
  // Row b starts at 600 in the scroller and 100 on the strip.
  assert.equal(ownOf(layout, 600), 100);
  assert.equal(ownOf(layout, 750), 250);
  assert.equal(bbOf(layout, 100), 600);
  assert.equal(bbOf(layout, 250), 750);
  assert.equal(ownOf(layout, -50), 0);
  assert.equal(ownOf(layout, 5000), layout.total);
  // The span above the first row on screen is spread over the rows the data holds above it.
  assert.equal(ownOf(layout, 300), 50);
});

test("estimates are corrected by how the measured rows of their kind turned out", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => item(id, 100));
  const cache = new Map<string, Measure>([
    ["a", { h: 200, w: 1 }],
    ["b", { h: 200, w: 1 }],
    ["c", { h: 200, w: 1 }],
  ]);
  const layout = buildLayout({ items, mounted: [mounted("c", 2, 400, 200)], cache, total: 1000 });
  assert.equal(layout.h[3], 200);
  assert.equal(layout.h[4], 200);
});

test("rows the data folds away take no room", () => {
  const items = [item("a", 100), item("folded", 0), item("b", 100), item("c", 100)];
  const layout = buildLayout({ items, mounted: [mounted("c", 3, 400, 100)], cache: new Map(), total: 500 });
  assert.deepEqual(layout.ids, ["a", "b", "c"]);
});

test("rows on screen that the data does not know are drawn as they are", () => {
  const layout = buildLayout({ items: [item("a", 100)], mounted: [mounted("x", null, 500, 100)], cache: new Map(), total: 2000 });
  assert.deepEqual(layout.ids, ["x"]);
  assert.equal(ownOf(layout, 500), 500);
});

test("nothing mounted draws nothing", () => {
  assert.equal(buildLayout({ items: [item("a", 100)], mounted: [], cache: new Map(), total: 100 }).ids.length, 0);
});

test("rectAt finds the rectangle holding an offset", () => {
  const items = [item("a", 100), item("b", 100), item("c", 100)];
  const layout = buildLayout({ items, mounted: [mounted("c", 2, 200, 100)], cache: new Map(), total: 300 });
  assert.equal(rectAt(layout, 0), 0);
  assert.equal(rectAt(layout, 150), 1);
  assert.equal(rectAt(layout, 299), 2);
  assert.equal(rectAt(layout, -5), -1);
});

test("the thread always spans the strip, short or long", () => {
  assert.equal(scaleFor(20000, 800), 0.04);
  assert.equal(scaleFor(400, 800), 2);
  assert.equal(scaleFor(0, 800), 0.1);
});

test("a click centres the viewport at the point and a drag keeps the grab", () => {
  // No rows on screen: both kinds of pixel are the same.
  const plain = buildLayout({ items: [], mounted: [mounted("x", null, 0, 1000)], cache: new Map(), total: 2000 });
  assert.equal(scrollForClick(plain, 100, 0.1, 800), 600);
  assert.equal(scrollForDrag(plain, 150, 20, 0.1), 1300);
});

test("a live turn's folded lines take the room they have on screen, not one estimate per tool call", () => {
  const items = [item("u", 60, "user"), item("w1", 26, "work"), item("w2", 26, "work"), item("w3", 26, "work"), item("w4", 26, "work"), item("r", 100, "reply")];
  // Two lines on screen: the first stands for w1 and w2, the second for w3 and w4.
  const rows = [
    mounted("t:work-summary:w1", 1, 60, 46, "work"),
    mounted("t:work-summary:w3", 3, 106, 46, "work"),
    mounted("t:reply", 5, 152, 100),
  ];
  const got = foldedHeights(items, rows);
  assert.deepEqual([...got.entries()].map(([id, m]) => [id, m.h]), [["w1", 46], ["w2", 0], ["w3", 46], ["w4", 0]]);
});

test("a folded line whose run is not in sight is left to the estimate", () => {
  const items = [item("w1", 26, "work"), item("w2", 26, "work"), item("w3", 26, "work")];
  const got = foldedHeights(items, [mounted("t:work-summary:w1", 0, 0, 46, "work")]);
  // The run ends the thread, so the line may stand for all of it.
  assert.equal(got.get("w3")?.h, 0);
  const more = [...items, item("w4", 26, "work"), item("r", 60, "reply")];
  const open = foldedHeights(more, [mounted("t:work-summary:w1", 0, 0, 46, "work")]);
  // The reply that ends the run is not on screen, so only the first row is known.
  assert.equal(open.get("w1")?.h, 46);
  assert.equal(open.has("w2"), false);
});

test("in the scroller's pixels rows on screen keep their places and the whole spans the scroller", () => {
  const items = ["a", "b", "c", "d"].map((id) => item(id, 100));
  const own = buildLayout({ items, mounted: [mounted("b", 1, 600, 100), mounted("c", 2, 700, 100)], cache: new Map(), total: 1000 });
  const bb = inScrollerPixels(own);
  assert.equal(bb.y[1], 600);
  assert.equal(bb.h[1], 100);
  assert.equal(bb.y[2], 700);
  assert.equal(bb.total, 1000);
  // The row above is stretched over the 600px the scroller holds above the first row on screen.
  assert.equal(bb.y[0], 0);
  assert.equal(bb.h[0], 600);
  assert.equal(ownOf(bb, 750), 750);
});

test("a row measured while its turn worked and folded away since leaves no ghost rectangle", () => {
  const items = [item("a", 100), item("tool", 0, "work"), item("b", 100), item("c", 100)];
  const cache = new Map<string, Measure>([["tool", { h: 28, w: 1 }]]);
  const layout = buildLayout({ items, mounted: [mounted("c", 3, 200, 100)], cache, total: 300 });
  assert.deepEqual(layout.ids, ["a", "b", "c"]);
});
