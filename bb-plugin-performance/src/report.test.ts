import assert from "node:assert/strict";
import test from "node:test";
import { CORE, emptyWindow, type Measure, type NavLine, type SlowLine } from "./model.ts";
import { buildReport } from "./report.ts";

const row = (over: Partial<Measure>): Measure => ({ id: "long", label: "Longest blocked frame", how: "", value: 120, unit: "ms", target: 50, n: 4, gap: 70, tone: "bad", ...over });

test("the report names the biggest costs and drops what is absent", () => {
  const merged = emptyWindow("s", 1);
  merged.loaf.n = 3;
  merged.split = { frameMs: 300, scriptMs: 200, forcedMs: 80, styleMs: 60, otherMs: 40 };
  merged.byPlugin = { [CORE]: { ms: 150, n: 3, forced: 60, by: { message: 120, timer: 30 } } };
  const text = buildReport({
    at: Date.UTC(2026, 10, 2),
    rangeLabel: "15 minutes",
    minutes: 12,
    bb: "0.48.1",
    rows: [row({}), row({ id: "frame", label: "Frame", value: null, tone: "none", gap: null })],
    merged,
    plugins: [
      { id: "tasks", loafMs: 40, forcedMs: 10, frames: 2, startMs: 14, cssRules: 589, words: [["wide", 3], ["hover:", 9]], probeMs: 22, version: "1.2.0" },
      { id: "quiet", loafMs: 0, forcedMs: 0, frames: 0, startMs: null, cssRules: null, words: [], probeMs: null, version: null },
    ],
    slows: [],
    marks: [],
    probe: null,
    bench: null,
  });
  assert.match(text, /Longest blocked frame: 120 ms \(target 50 ms, over by 70 ms\)/);
  assert.match(text, /Frame: no data/);
  assert.match(text, /3 frames over 50 ms.*mostly script-bound/);
  assert.match(text, /forced layout 80 ms/);
  assert.match(text, /BB core started by: Message callbacks.* 120 ms, Timers 30 ms/);
  assert.match(text, /- tasks 1\.2\.0: script in slow frames 40 ms \(forced layout 10 ms\) in 2 frames; start 14 ms; 589 page-wide CSS rules \(words: wide×3; variants: hover×9\); style recalculation 22 ms/);
  assert.doesNotMatch(text, /quiet/);
  assert.doesNotMatch(text, /Slowest moments|Marked as lagging|benchmark|probe/);
});

test("the report says where layout was forced, how inputs waited, and which values are floors", () => {
  const merged = emptyWindow("s", 1);
  merged.loaf.n = 2;
  merged.split = { frameMs: 200, scriptMs: 180, forcedMs: 150, styleMs: 10, otherMs: 10 };
  merged.byPlugin = { [CORE]: { ms: 180, n: 2, forced: 150 } };
  merged.sites = { "BB core · measure@1234": { ms: 120, n: 7 } };
  const slow: SlowLine = { v: 1, t: 1, kind: "slow", session: "s", what: "input", ms: 1300, blocking: 0, driver: "other", scripts: [{ owner: CORE, ms: 900, inv: "frame" }], phases: { delay: 1200, handler: 40, present: 60 } };
  const nav = (ms: number, rows: number, virtualized: boolean): NavLine => ({ v: 1, t: 1, kind: "nav", session: "s", what: "thread-switch", ms, settled: true, rows, virtualized, route: "/", split: { frameMs: ms, scriptMs: ms, forcedMs: ms / 2, styleMs: 0, otherMs: 0 } });
  const text = buildReport({
    at: 0,
    rangeLabel: "15 minutes",
    minutes: 5,
    bb: null,
    rows: [row({ id: "click", label: "Click to screen", value: 1000, capped: true })],
    merged,
    plugins: [{ id: "a", loafMs: 0, forcedMs: 0, frames: 0, startMs: null, cssRules: 5, words: [], probeMs: null, version: null }],
    slows: [slow],
    marks: [],
    probe: null,
    bench: null,
    navs: [nav(1400, 60, true), nav(80, 6, false)],
  });
  assert.match(text, /Click to screen: at least 1000 ms/);
  assert.match(text, /Where layout was forced[\s\S]*BB core · measure@1234: 120 ms in 7 calls/);
  assert.match(text, /waited 1200 ms, handlers 40 ms, paint 60 ms \(queued behind other work\)/);
  assert.match(text, /2 switches, median 740 ms, 1 over 100 ms/);
  assert.match(text, /Rows on screen \(median\): 60 in the slow ones, 6 in the fast ones/);
  assert.match(text, /plugins 0 ms, BB core 180 ms\. No plugin bundle ran in a slow frame/);
});
