import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToHist,
  CORE,
  driverAt,
  emptyHist,
  emptyWindow,
  hashOf,
  heapSlope,
  histOver,
  measures,
  mergeWindows,
  ownerOf,
  pluginRows,
  quantile,
  boundOf,
  classOfSelector,
  phaseBound,
  phasesOf,
  topSites,
  unescapeClass,
  utilityOf,
  classParts,
  splitWords,
  coreKinds,
  kindOf,
  pluginSeries,
  series,
  shares,
  splitOf,
  toneOf,
  worstGap,
} from "./model.ts";

test("quantile reads the bucket edge that holds the rank", () => {
  const h = emptyHist();
  for (const ms of [5, 6, 7, 10, 12, 20, 30, 45, 60, 90]) addToHist(h, ms);
  assert.equal(quantile(h, 0.5), 17); // the 5th sample (12) falls in the 8..17 bucket
  assert.equal(quantile(h, 0.95), 100);
  assert.equal(quantile(emptyHist(), 0.5), null);
});

test("samples past the last edge report that edge", () => {
  const h = emptyHist();
  addToHist(h, 5000);
  assert.equal(quantile(h, 0.99), 1000);
});

test("histOver counts only buckets above an edge", () => {
  const h = emptyHist();
  for (const ms of [10, 40, 50, 51, 90]) addToHist(h, ms);
  assert.equal(histOver(h, 50), 2); // 51 and 90; 50 sits in the bucket that ends at 50
  assert.throws(() => histOver(h, 49));
});

test("tones: good within the target, warn under twice it, bad beyond", () => {
  assert.equal(toneOf(16, 16), "good");
  assert.equal(toneOf(32, 16), "warn");
  assert.equal(toneOf(33, 16), "bad");
  assert.equal(toneOf(null, 16), "none");
});

test("merged windows add counts and keep the worst", () => {
  const a = emptyWindow("a", 1);
  const b = emptyWindow("b", 2);
  a.loaf.n = 2;
  a.loaf.worst = 80;
  b.loaf.n = 1;
  b.loaf.worst = 120;
  a.byPlugin["bb--git"] = { ms: 40, n: 1 };
  b.byPlugin["bb--git"] = { ms: 30, n: 2 };
  addToHist(a.frame.hist, 10);
  addToHist(b.frame.hist, 40);
  const m = mergeWindows([a, b]);
  assert.equal(m.loaf.n, 3);
  assert.equal(m.loaf.worst, 120);
  assert.deepEqual(m.byPlugin["bb--git"], { ms: 70, n: 3 });
  assert.equal(m.t, 2);
  assert.equal(quantile(m.frame.hist, 1), 50);
});

test("measures leave a value empty when there is nothing behind it", () => {
  const rows = measures(emptyWindow("s", 0), { switches: [], panels: [] }, { settled: null }, null);
  assert.ok(rows.every((r) => r.value == null && r.tone === "none"));
});

test("typing with keys but no slow ones reads as within target", () => {
  const w = emptyWindow("s", 0);
  w.input.keys = 120;
  const typing = measures(w, { switches: [], panels: [] }, { settled: null }, null).find((r) => r.id === "typing");
  assert.equal(typing?.value, 0);
  assert.equal(typing?.tone, "good");
});

test("thread switch is the median of the switches", () => {
  const rows = measures(emptyWindow("s", 0), { switches: [300, 80, 120], panels: [] }, { settled: 900 }, 2);
  assert.equal(rows.find((r) => r.id === "switch")?.value, 120);
  assert.equal(rows.find((r) => r.id === "start")?.tone, "good");
  assert.equal(rows.find((r) => r.id === "heap")?.tone, "good");
});

test("the worst gap is the biggest ratio over target", () => {
  const w = emptyWindow("s", 0);
  w.loaf.n = 1;
  w.loaf.worst = 300; // 6x its target
  const rows = measures(w, { switches: [150], panels: [] }, { settled: 1200 }, null);
  assert.equal(worstGap(rows)?.id, "long");
  assert.equal(worstGap(measures(emptyWindow("s", 0), { switches: [], panels: [] }, { settled: 500 }, null)), null);
});

test("heap slope needs ten minutes and three samples", () => {
  const hour = 3_600_000;
  assert.equal(heapSlope([{ t: 0, mb: 1 }, { t: 1000, mb: 2 }]), null);
  const slope = heapSlope([0, 1, 2, 3].map((i) => ({ t: (i * hour) / 3, mb: 100 + i * 10 })));
  assert.ok(slope != null && Math.abs(slope - 30) < 1e-6);
});

test("owner of a script comes from the bundle path, query and origin stripped", () => {
  const urls = new Map([["/api/v1/plugin-app-assets/aa11/app.js", "bb--git"]]);
  const origin = "http://127.0.0.1:38888";
  assert.equal(ownerOf(`${origin}/api/v1/plugin-app-assets/aa11/app.js?x=1`, urls, origin), "bb--git");
  assert.equal(ownerOf(`${origin}/assets/index-abc.js`, urls, origin), CORE);
  assert.equal(ownerOf("", urls, origin), CORE);
  assert.equal(ownerOf(`${origin}/api/v1/plugin-app-assets/bb22cc33dd44/app.js`, urls, origin), "plugin:bb22cc33");
  assert.equal(hashOf("/api/v1/plugin-app-assets/aa11/app.css?host-tailwind=ff"), "aa11");
  assert.equal(hashOf("/assets/x.css"), null);
});

test("driver: the newest recent input wins, a navigation outranks typing", () => {
  const last = { typing: 5000, scroll: 4800, nav: 0, input: 5000 };
  assert.equal(driverAt(5400, last), "typing");
  assert.equal(driverAt(5400, { ...last, nav: 5300 }), "nav");
  assert.equal(driverAt(9000, last), "idle");
  assert.equal(driverAt(4900, { typing: 0, scroll: 4800, nav: 0, input: 4800 }), "scroll");
});

test("plugin rows merge every source and flag the heavy ones", () => {
  const w = emptyWindow("s", 0);
  w.byPlugin["tasks"] = { ms: 150, n: 4 };
  w.byPlugin[CORE] = { ms: 900, n: 9 };
  const rows = pluginRows(w, { tasks: 589, "chat-dock": 12 }, { tasks: 32 }, { "bb--git": { calls: 5, maxMs: 90, errors: 2 } }, { "bb--git": { rssMB: 80, cpuPct: 0.2 } });
  assert.deepEqual(rows.map((r) => r.id), ["tasks", "chat-dock", "bb--git"]);
  assert.deepEqual(rows[0].flags, ["slow frames", "page-wide CSS"]);
  assert.deepEqual(rows[2].flags, ["handler errors"]);
  assert.equal(rows[2].workerRssMB, 80);
  assert.ok(!rows.some((r) => r.id === CORE));
});

test("series puts windows into time buckets and leaves empty ones null", () => {
  const now = 10 * 60_000;
  const a = emptyWindow("s", 90_000);
  a.visibleMs = 60_000;
  a.idleBusyMs = 6_000;
  a.loaf.n = 2;
  a.loaf.worst = 120;
  a.byPlugin = { [CORE]: { ms: 80, n: 2 }, tasks: { ms: 20, n: 1 } };
  addToHist(a.frame.hist, 30);
  const b = emptyWindow("s", 9 * 60_000 + 1);
  b.visibleMs = 30_000;
  const out = series([a, b], now, now, 10);
  assert.equal(out.length, 10);
  assert.equal(out[1].idlePct, 10);
  assert.equal(out[1].longest, 120);
  assert.equal(out[1].frameP95, 34);
  assert.equal(out[1].coreMs, 80);
  assert.equal(out[1].pluginMs, 20);
  assert.equal(out[0].idlePct, null);
  assert.equal(out[9].idlePct, 0);
  assert.equal(out[9].longest, null);
});

test("shares keeps the biggest owners and folds the rest, never BB core", () => {
  const byPlugin = { [CORE]: { ms: 5, n: 1 }, a: { ms: 50, n: 1 }, b: { ms: 40, n: 1 }, c: { ms: 30, n: 1 }, d: { ms: 20, n: 1 } };
  const out = shares(byPlugin, 2);
  assert.deepEqual(out.map((s) => s.id), ["a", "b", CORE, "others"]);
  assert.equal(out[3].ms, 50);
});

test("kindOf folds invokers into kinds", () => {
  assert.equal(kindOf("user-callback", "FrameRequestCallback"), "raf");
  assert.equal(kindOf("user-callback", "TimerHandler:setTimeout"), "timer");
  assert.equal(kindOf("event-listener", "MessagePort.onmessage"), "message");
  assert.equal(kindOf("event-listener", "BUTTON#x.onclick"), "event");
  assert.equal(kindOf("resolve-promise", "Promise.then"), "promise");
  assert.equal(kindOf("module-script", ""), "script");
  assert.equal(kindOf("whatever", ""), "other");
});

test("splitOf divides a frame into script, forced layout, style and the rest", () => {
  const s = splitOf({
    duration: 200,
    startTime: 1000,
    styleAndLayoutStart: 1150,
    scripts: [
      { duration: 90, forcedStyleAndLayoutDuration: 30 },
      { duration: 10, forcedStyleAndLayoutDuration: 5 },
    ],
  });
  assert.deepEqual(s, { frameMs: 200, scriptMs: 100, forcedMs: 35, styleMs: 50, otherMs: 50 });
  assert.equal(boundOf(s), "script");
  assert.equal(boundOf({ frameMs: 200, scriptMs: 5, forcedMs: 0, styleMs: 180, otherMs: 15 }), "render");
  assert.equal(boundOf({ frameMs: 200, scriptMs: 5, forcedMs: 0, styleMs: 10, otherMs: 185 }), "other");
});

test("mergeWindows adds splits, forced layout and callback kinds", () => {
  const a = emptyWindow("s", 1);
  a.split = { frameMs: 100, scriptMs: 60, forcedMs: 20, styleMs: 30, otherMs: 10 };
  a.byPlugin = { [CORE]: { ms: 50, n: 1, forced: 10, by: { message: 40, timer: 10 } } };
  const b = emptyWindow("s", 2);
  b.split = { frameMs: 50, scriptMs: 20, forcedMs: 5, styleMs: 20, otherMs: 10 };
  b.byPlugin = { [CORE]: { ms: 20, n: 1, forced: 4, by: { message: 20 } } };
  const old = emptyWindow("s", 3);
  delete old.split;
  const m = mergeWindows([a, b, old]);
  assert.deepEqual(m.split, { frameMs: 150, scriptMs: 80, forcedMs: 25, styleMs: 50, otherMs: 20 });
  assert.equal(m.byPlugin[CORE].forced, 14);
  assert.deepEqual(m.byPlugin[CORE].by, { message: 60, timer: 10 });
  assert.deepEqual(coreKinds(m.byPlugin).map((k) => [k.id, k.ms]), [["message", 60], ["timer", 10]]);
});

test("pluginSeries sums one plugin per bucket and leaves empty buckets null", () => {
  const now = 4 * 60_000;
  const a = emptyWindow("s", 30_000);
  a.visibleMs = 30_000;
  a.byPlugin = { tasks: { ms: 12, n: 1 } };
  const b = emptyWindow("s", 40_000);
  b.visibleMs = 30_000;
  b.byPlugin = { tasks: { ms: 8, n: 1 } };
  const out = pluginSeries([a, b], "tasks", now, now, 4);
  assert.deepEqual(out, [20, null, null, null]);
});

test("class names are read back from escaped selectors", () => {
  assert.equal(classOfSelector(":where([data-bb-plugin=x],[data-bb-plugin-root]) .max-md\\:zed"), "max-md:zed");
  assert.equal(classOfSelector(":where([data-bb-plugin=x]) .data-\\[state\\=open\\]\\:zed-a"), "data-[state=open]:zed-a");
  assert.equal(classOfSelector(":where([data-bb-plugin=x]) .zed"), "zed");
  assert.equal(classOfSelector(".plain"), null);
  assert.equal(unescapeClass("a\\31 b"), "a1b");
  assert.equal(utilityOf("max-md:hover:zed"), "zed");
  assert.equal(utilityOf("data-[state=open]:zed-a"), "zed-a");
  assert.equal(utilityOf("[&>svg]:zed-4"), "zed-4");
  assert.equal(utilityOf("zed-[color:var(--x)]"), "zed-[color:var(--x)]");
  assert.equal(utilityOf("zed"), "zed");
});

test("an input divides into its wait, its handlers and its paint", () => {
  const p = phasesOf({ startTime: 100, duration: 900, processingStart: 950, processingEnd: 990 });
  assert.deepEqual(p, { delay: 850, handler: 40, present: 10 });
  assert.equal(phaseBound(p), "delay");
  assert.equal(phaseBound({ delay: 5, handler: 90, present: 5 }), "handler");
  assert.equal(phaseBound({ delay: 5, handler: 9, present: 80 }), "present");
});

test("sites merge across windows and the biggest come first", () => {
  const a = emptyWindow("s", 1);
  a.sites = { "BB core f:10": { ms: 100, n: 2 }, "BB core g:5": { ms: 30, n: 1 } };
  const b = emptyWindow("s", 2);
  b.sites = { "BB core f:10": { ms: 50, n: 1 } };
  const m = mergeWindows([a, b]);
  assert.deepEqual(topSites(m.sites, 5), [["BB core f:10", { ms: 150, n: 3 }], ["BB core g:5", { ms: 30, n: 1 }]]);
  assert.deepEqual(topSites(undefined), []);
});

test("a percentile in a histogram's last bucket is marked as a floor", () => {
  const w = emptyWindow("s", 1);
  w.input.click = emptyHist();
  addToHist(w.input.click, 1500);
  w.input.clicks = 1;
  const row = measures(w, { switches: [], panels: [] }, { settled: null }, null).find((r) => r.id === "click")!;
  assert.equal(row.value, 1000);
  assert.equal(row.capped, true);
});

test("a class splits into its bare word and its variants, and tallies split back", () => {
  assert.deepEqual(classParts("max-md:hover:zed"), { word: "zed", variant: "max-md:hover" });
  assert.deepEqual(classParts("data-[state=open]:zed-a"), { word: "zed-a", variant: "data-[state=open]" });
  assert.deepEqual(classParts("zed"), { word: "zed", variant: "" });
  const { words, variants } = splitWords([["zed", 3], ["hover:", 9]]);
  assert.deepEqual(words, [["zed", 3]]);
  assert.deepEqual(variants, [["hover:", 9]]);
});
