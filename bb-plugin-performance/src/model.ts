// bb-plugin-performance — the pure rules: targets, histograms, the shape of a
// metrics line, and how lines merge into the numbers the dashboard shows. No
// DOM and no BB imports, so the server, the page and the tests share it.

/** What "feels native" means, in milliseconds unless noted. Written at the top of every metrics file. */
export const TARGETS = {
  /** One frame at 60 fps is 16.7 ms; the histogram edge above it is 17, so that is the line. */
  frameMs: 17,
  /** No frame may stall longer than this (the Long Animation Frames threshold). */
  longFrameMs: 50,
  /** Typing or a click reaches the screen within this. */
  inputMs: 50,
  /** A thread switch or a panel opening settles within this. */
  switchMs: 100,
  /** Cold start settles within this. */
  startMs: 1000,
  /** Idle: busy share of an idle second, in percent, and heap growth in MB per hour. */
  idleBusyPct: 1,
  heapGrowthMbPerHour: 5,
} as const;

/** Upper edges (ms) of the histogram buckets; the last bucket is everything above the final edge. */
export const EDGES = [8, 17, 25, 34, 50, 66, 100, 150, 250, 500, 1000] as const;
export type Hist = number[];

export const emptyHist = (): Hist => new Array(EDGES.length + 1).fill(0);

export function bucketOf(ms: number): number {
  for (let i = 0; i < EDGES.length; i++) if (ms <= EDGES[i]) return i;
  return EDGES.length;
}

export function addToHist(hist: Hist, ms: number) {
  hist[bucketOf(ms)]++;
}

export const histCount = (hist: Hist) => hist.reduce((a, b) => a + b, 0);

/** Counts above `ms`, which must be one of the edges; samples inside the bucket that ends at `ms` do not count. */
export function histOver(hist: Hist, ms: number): number {
  const edge = EDGES.indexOf(ms as (typeof EDGES)[number]);
  if (edge < 0) throw new Error(`${ms} is not a histogram edge`);
  let n = 0;
  for (let i = edge + 1; i < hist.length; i++) n += hist[i];
  return n;
}

export function mergeHist(a: Hist, b: Hist): Hist {
  return a.map((n, i) => n + (b[i] ?? 0));
}

/** The upper edge of the bucket holding the `p` quantile (0..1), or null when empty. The open last bucket reports its lower edge. */
export function quantile(hist: Hist, p: number): number | null {
  const total = histCount(hist);
  if (total === 0) return null;
  const rank = Math.max(1, Math.ceil(total * p));
  let seen = 0;
  for (let i = 0; i < hist.length; i++) {
    seen += hist[i];
    if (seen >= rank) return i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1];
  }
  return EDGES[EDGES.length - 1];
}

// --- metrics lines ----------------------------------------------------------------------

export const CORE = "BB core";

/** What started a script: the browser's own words, folded into a few kinds. */
export type CallKind = "raf" | "timer" | "message" | "event" | "promise" | "script" | "other";

export const CALL_KINDS: { id: CallKind; label: string }[] = [
  { id: "message", label: "Message callbacks (React's scheduler uses these)" },
  { id: "timer", label: "Timers" },
  { id: "event", label: "Event handlers" },
  { id: "raf", label: "Per-frame callbacks" },
  { id: "promise", label: "Promises" },
  { id: "script", label: "Script loading" },
  { id: "other", label: "Other" },
];

/** Folds a Long Animation Frames `invokerType` and `invoker` into a `CallKind`. */
export function kindOf(invokerType: string, invoker: string): CallKind {
  if (invokerType === "user-callback") {
    if (/FrameRequestCallback/.test(invoker)) return "raf";
    if (/^TimerHandler/.test(invoker)) return "timer";
    return "other";
  }
  if (invokerType === "event-listener") return /MessagePort|BroadcastChannel|onmessage/i.test(invoker) ? "message" : "event";
  if (invokerType === "resolve-promise" || invokerType === "reject-promise") return "promise";
  if (invokerType === "classic-script" || invokerType === "module-script") return "script";
  return "other";
}

/** Time attributed to one owner of a script, in a window. `forced` is the part of `ms` spent in layout the script forced. */
export interface Owner {
  ms: number;
  n: number;
  forced?: number;
  by?: Partial<Record<CallKind, number>>;
}

/** How slow frames divide. `forcedMs` is inside `scriptMs`; the rest of a frame is style and layout, then other tasks. */
export interface Split {
  frameMs: number;
  scriptMs: number;
  forcedMs: number;
  styleMs: number;
  otherMs: number;
}

export const emptySplit = (): Split => ({ frameMs: 0, scriptMs: 0, forcedMs: 0, styleMs: 0, otherMs: 0 });

export function addSplit(into: Split, add: Split | undefined): Split {
  if (!add) return into;
  into.frameMs += add.frameMs;
  into.scriptMs += add.scriptMs;
  into.forcedMs += add.forcedMs;
  into.styleMs += add.styleMs;
  into.otherMs += add.otherMs;
  return into;
}

interface FrameShape {
  duration: number;
  startTime: number;
  styleAndLayoutStart: number;
  scripts: { duration: number; forcedStyleAndLayoutDuration: number }[];
}

/** The split of one Long Animation Frames entry. Style and layout is what ran after `styleAndLayoutStart`, paint included. */
export function splitOf(e: FrameShape): Split {
  const script = e.scripts.reduce((a, x) => a + x.duration, 0);
  const forced = e.scripts.reduce((a, x) => a + x.forcedStyleAndLayoutDuration, 0);
  const style = Math.max(0, e.startTime + e.duration - e.styleAndLayoutStart);
  return { frameMs: e.duration, scriptMs: script, forcedMs: Math.min(forced, script), styleMs: style, otherMs: Math.max(0, e.duration - script - style) };
}

export type Bound = "script" | "render" | "other";

/** What a frame was mostly waiting on: its script, its style and layout, or other tasks. */
export function boundOf(split: Split): Bound {
  const top = Math.max(split.scriptMs, split.styleMs, split.otherMs);
  if (top === split.scriptMs) return "script";
  return top === split.styleMs ? "render" : "other";
}

export type Driver = "typing" | "scroll" | "nav" | "idle" | "other";

export interface WindowLine {
  v: 1;
  t: number;
  kind: "window";
  session: string;
  /** Milliseconds the window covered, and how many of them the page was on screen. */
  dur: number;
  visibleMs: number;
  /** Frame intervals measured only while the reader scrolled or typed. */
  frame: { hist: Hist; worst: number };
  /** Frames over 50ms from Long Animation Frames. */
  loaf: { n: number; blockingMs: number; worst: number; byDriver: Record<Driver, number> };
  /** Busy time (ms) of long frames when nobody was interacting. */
  idleBusyMs: number;
  /** Interactions of 16ms or more, by kind, plus the totals dispatched (Event Timing hides the faster ones). */
  input: { typing: Hist; click: Hist; worst: number; keys: number; clicks: number };
  byPlugin: Record<string, Owner>;
  heapMB: number | null;
  /** What the plugin's own callbacks cost in this window. */
  selfMs: number;
  /** How the long frames of this window divide. Absent in files written before it was recorded. */
  split?: Split;
  /** Where scripts forced layout: the biggest call sites of the window, by owner, function and position in its bundle. */
  sites?: Record<string, Site>;
}

/** One place in a bundle that forced layout: time and how many times. */
export interface Site {
  ms: number;
  n: number;
}

export const SITES_KEEP = 12;

/** The largest `keep` sites of a map, by time. */
export function topSites(sites: Record<string, Site> | undefined, keep = SITES_KEEP): [string, Site][] {
  return Object.entries(sites ?? {})
    .sort((a, b) => b[1].ms - a[1].ms || a[0].localeCompare(b[0]))
    .slice(0, keep);
}

/** How an input divided: waiting for the page to be free, its handlers, then the paint. */
export interface Phases {
  delay: number;
  handler: number;
  present: number;
}

/** The phases of an Event Timing entry; the three add up to its duration. */
export function phasesOf(e: { startTime: number; duration: number; processingStart: number; processingEnd: number }): Phases {
  const delay = Math.max(0, e.processingStart - e.startTime);
  const handler = Math.max(0, e.processingEnd - e.processingStart);
  return { delay: Math.round(delay), handler: Math.round(handler), present: Math.round(Math.max(0, e.startTime + e.duration - e.processingEnd)) };
}

/** What kept an input waiting: its own wait, its handlers, or the paint after them. */
export function phaseBound(p: Phases): "delay" | "handler" | "present" {
  const top = Math.max(p.delay, p.handler, p.present);
  return top === p.delay ? "delay" : top === p.handler ? "handler" : "present";
}

export interface SlowLine {
  v: 1;
  t: number;
  kind: "slow";
  session: string;
  what: "loaf" | "input";
  ms: number;
  blocking: number;
  driver: Driver;
  scripts: { owner: string; ms: number; inv: string; forced?: number; kind?: CallKind }[];
  split?: Split;
  /** For an input: how it divided. Its `scripts` are those of the frames it ran in. */
  phases?: Phases;
}

export interface NavLine {
  v: 1;
  t: number;
  kind: "nav";
  session: string;
  what: "thread-switch" | "panel-open" | "page";
  ms: number;
  /** False when the page was still changing at the cap, so `ms` is a floor. */
  settled: boolean;
  rows: number;
  virtualized: boolean;
  route: string;
  /** The long frames that ran while it settled: how they divide, and how many. Absent in older files. */
  split?: Split;
  frames?: number;
}

export interface StartLine {
  v: 1;
  t: number;
  kind: "start";
  session: string;
  fcp: number | null;
  settled: number;
  domContentLoaded: number | null;
  load: number | null;
  pluginMs: Record<string, number>;
}

export interface CssLine {
  v: 1;
  t: number;
  kind: "css";
  session: string;
  cssRules: Record<string, number>;
  total: number;
  /** The class names behind each plugin's page-wide rules, most common first. */
  words?: Record<string, Record<string, number>>;
}

/** "This lagged": what the last seconds looked like when the reader pressed the button. */
export interface MarkLine {
  v: 1;
  t: number;
  kind: "mark";
  session: string;
  route: string;
  /** Long frames in the last 15 s, the worst, and how they divide. */
  frames: number;
  worst: number;
  split: Split;
  owners: Record<string, number>;
  elements: number;
}

/** A thread-switch benchmark: each hop's time to settle, in the order run. */
export interface BenchLine {
  v: 1;
  t: number;
  kind: "bench";
  session: string;
  threads: number;
  rounds: number;
  hops: number[];
  median: number;
  p95: number;
  /** True when every plugin stylesheet was switched off for the run. */
  cssOff?: boolean;
  /** Plugins installed and enabled when it ran, so two runs can be compared. */
  plugins: number;
}

/** A style-recalculation probe: what one full recalculation costs with and without each plugin's stylesheet. */
export interface ProbeLine {
  v: 1;
  t: number;
  kind: "probe";
  session: string;
  elements: number;
  rules: number;
  /** One full recalculation with every stylesheet, and with every plugin stylesheet switched off. */
  baseMs: number;
  withoutMs: number;
  perPlugin: Record<string, { ms: number; rules: number; own?: number }>;
}

export interface ServerLine {
  v: 1;
  t: number;
  kind: "server";
  eventLoop: { p50: number; p99: number; max: number };
  cpuPct: number;
  rssMB: number;
  heapMB: number;
  workers: Record<string, { rssMB: number; cpuPct: number }>;
  handlers: Record<string, { calls: number; maxMs: number; errors: number }>;
}

export interface TargetsLine {
  v: 1;
  t: number;
  kind: "targets";
  bb: string | null;
  plugins: Record<string, string>;
  targets: typeof TARGETS;
}

export type Line = WindowLine | SlowLine | NavLine | StartLine | CssLine | ServerLine | TargetsLine | MarkLine | BenchLine | ProbeLine;

export const emptyWindow = (session: string, t: number): WindowLine => ({
  v: 1,
  t,
  kind: "window",
  session,
  dur: 0,
  visibleMs: 0,
  frame: { hist: emptyHist(), worst: 0 },
  loaf: { n: 0, blockingMs: 0, worst: 0, byDriver: { typing: 0, scroll: 0, nav: 0, idle: 0, other: 0 } },
  idleBusyMs: 0,
  input: { typing: emptyHist(), click: emptyHist(), worst: 0, keys: 0, clicks: 0 },
  byPlugin: {},
  heapMB: null,
  selfMs: 0,
  split: emptySplit(),
});

export function mergeWindows(windows: WindowLine[]): WindowLine {
  const out = emptyWindow("merged", windows.reduce((t, w) => Math.max(t, w.t), 0));
  for (const w of windows) {
    out.dur += w.dur;
    out.visibleMs += w.visibleMs;
    out.frame.hist = mergeHist(out.frame.hist, w.frame.hist);
    out.frame.worst = Math.max(out.frame.worst, w.frame.worst);
    out.loaf.n += w.loaf.n;
    out.loaf.blockingMs += w.loaf.blockingMs;
    out.loaf.worst = Math.max(out.loaf.worst, w.loaf.worst);
    for (const k of Object.keys(out.loaf.byDriver) as Driver[]) out.loaf.byDriver[k] += w.loaf.byDriver[k] ?? 0;
    out.idleBusyMs += w.idleBusyMs;
    out.input.typing = mergeHist(out.input.typing, w.input.typing);
    out.input.click = mergeHist(out.input.click, w.input.click);
    out.input.worst = Math.max(out.input.worst, w.input.worst);
    out.input.keys += w.input.keys;
    out.input.clicks += w.input.clicks;
    for (const [id, o] of Object.entries(w.byPlugin)) {
      const into = (out.byPlugin[id] ??= { ms: 0, n: 0 });
      into.ms += o.ms;
      into.n += o.n;
      if (o.forced) into.forced = (into.forced ?? 0) + o.forced;
      for (const [k, v] of Object.entries(o.by ?? {})) {
        into.by ??= {};
        into.by[k as CallKind] = (into.by[k as CallKind] ?? 0) + (v ?? 0);
      }
    }
    if (w.heapMB != null) out.heapMB = w.heapMB;
    out.selfMs += w.selfMs;
    addSplit(out.split!, w.split);
    for (const [k, v] of Object.entries(w.sites ?? {})) {
      out.sites ??= {};
      const into = (out.sites[k] ??= { ms: 0, n: 0 });
      into.ms += v.ms;
      into.n += v.n;
    }
  }
  return out;
}

// --- measures: the rows of the dashboard ------------------------------------------------

export type Tone = "good" | "warn" | "bad" | "none";

export interface Measure {
  id: string;
  label: string;
  /** What the number is and how it was taken. */
  how: string;
  value: number | null;
  unit: "ms" | "%" | "MB/h";
  target: number;
  /** Samples behind the value. */
  n: number;
  gap: number | null;
  tone: Tone;
  /** The value sits in the last bucket of its histogram, so it is a floor, not a measure. */
  capped?: boolean;
}

/** good within the target, warn under twice it, bad beyond. No value, no tone. */
export function toneOf(value: number | null, target: number): Tone {
  if (value == null) return "none";
  if (value <= target) return "good";
  return value <= target * 2 ? "warn" : "bad";
}

function measure(id: string, label: string, how: string, value: number | null, unit: Measure["unit"], target: number, n: number): Measure {
  return { id, label, how, value, unit, target, n, gap: value == null ? null : value - target, tone: toneOf(value, target) };
}

export interface Navs {
  switches: number[];
  panels: number[];
}

export interface Start {
  settled: number | null;
}

/** Linear slope of heap samples, MB per hour; null under three samples or ten minutes of spread. */
export function heapSlope(samples: { t: number; mb: number }[]): number | null {
  if (samples.length < 3) return null;
  const t0 = samples[0].t;
  const span = samples[samples.length - 1].t - t0;
  if (span < 10 * 60_000) return null;
  const n = samples.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const s of samples) {
    const x = (s.t - t0) / 3_600_000;
    sx += x;
    sy += s.mb;
    sxx += x * x;
    sxy += x * s.mb;
  }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? null : (n * sxy - sx * sy) / denom;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** The dashboard's metric rows from merged window lines, nav times, the start line and the heap trend. */
export function measures(merged: WindowLine, navs: Navs, start: Start, heapGrowth: number | null): Measure[] {
  const frames = histCount(merged.frame.hist);
  const typing = histCount(merged.input.typing);
  const clicks = histCount(merged.input.click);
  const idleSeconds = merged.visibleMs / 1000;
  const rows = [
    measure("frame", "Frame while scrolling or typing", "95th percentile gap between frames, sampled only while you scroll or type", quantile(merged.frame.hist, 0.95), "ms", TARGETS.frameMs, frames),
    measure("long", "Longest blocked frame", "longest Long Animation Frame in the window", merged.loaf.n ? merged.loaf.worst : null, "ms", TARGETS.longFrameMs, merged.loaf.n),
    measure("typing", "Typing to screen", "95th percentile of key events of 16 ms or more (Event Timing: input to next paint)", typing ? quantile(merged.input.typing, 0.95) : merged.input.keys ? 0 : null, "ms", TARGETS.inputMs, merged.input.keys),
    measure("click", "Click to screen", "95th percentile of pointer and click events of 16 ms or more", clicks ? quantile(merged.input.click, 0.95) : merged.input.clicks ? 0 : null, "ms", TARGETS.inputMs, merged.input.clicks),
    measure("switch", "Thread switch", "median from the route change to the timeline going quiet for 100 ms", median(navs.switches), "ms", TARGETS.switchMs, navs.switches.length),
    measure("panel", "Panel open", "median from the panel's size change to it going quiet", median(navs.panels), "ms", TARGETS.switchMs, navs.panels.length),
    measure("start", "Cold start", "end of the last long frame in the first 10 s after load", start.settled, "ms", TARGETS.startMs, start.settled == null ? 0 : 1),
    measure("idle", "Idle busy", "share of idle time spent in long frames", idleSeconds > 0 ? (merged.idleBusyMs / merged.visibleMs) * 100 : null, "%", TARGETS.idleBusyPct, idleSeconds > 0 ? Math.round(idleSeconds) : 0),
    measure("heap", "Memory growth", "least-squares slope of the JS heap over the last hour", heapGrowth, "MB/h", TARGETS.heapGrowthMbPerHour, 0),
  ];
  // Histograms stop at their last edge, so a 95th percentile there only says "at least".
  for (const row of rows) if (["frame", "typing", "click"].includes(row.id) && row.value != null && row.value >= EDGES[EDGES.length - 1]) row.capped = true;
  return rows;
}

/** The worst measured gap, as the nav badge: the biggest value-to-target ratio over 1, or null when all is within target. */
export function worstGap(rows: Measure[]): Measure | null {
  let worst: Measure | null = null;
  let ratio = 1;
  for (const row of rows) {
    if (row.value == null || row.tone === "none") continue;
    const r = row.value / row.target;
    if (r > ratio) {
      ratio = r;
      worst = row;
    }
  }
  return worst;
}

// --- the plugin rows ----------------------------------------------------------------------

export interface PluginRow {
  id: string;
  /** Script time in slow frames this period, ms, and the frames it was in. */
  loafMs: number;
  frames: number;
  cssRules: number | null;
  startMs: number | null;
  handlerCalls: number;
  handlerMaxMs: number;
  handlerErrors: number;
  workerRssMB: number | null;
  workerCpuPct: number | null;
  /** Why a row is flagged. */
  flags: string[];
}

export const CSS_RULE_FLAG = 300;
export const START_FLAG_MS = 40;
export const LOAF_FLAG_MS = 100;

export function pluginRows(
  merged: WindowLine,
  css: Record<string, number>,
  start: Record<string, number>,
  handlers: Record<string, { calls: number; maxMs: number; errors: number }>,
  workers: Record<string, { rssMB: number; cpuPct: number }>,
): PluginRow[] {
  const ids = new Set<string>([...Object.keys(merged.byPlugin), ...Object.keys(css), ...Object.keys(start), ...Object.keys(handlers), ...Object.keys(workers)]);
  ids.delete(CORE);
  const rows: PluginRow[] = [];
  for (const id of ids) {
    const loaf = merged.byPlugin[id];
    const h = handlers[id];
    const w = workers[id];
    const row: PluginRow = {
      id,
      loafMs: Math.round(loaf?.ms ?? 0),
      frames: loaf?.n ?? 0,
      cssRules: css[id] ?? null,
      startMs: start[id] == null ? null : Math.round(start[id]),
      handlerCalls: h?.calls ?? 0,
      handlerMaxMs: Math.round(h?.maxMs ?? 0),
      handlerErrors: h?.errors ?? 0,
      workerRssMB: w?.rssMB ?? null,
      workerCpuPct: w?.cpuPct ?? null,
      flags: [],
    };
    if (row.loafMs >= LOAF_FLAG_MS) row.flags.push("slow frames");
    if ((row.cssRules ?? 0) >= CSS_RULE_FLAG) row.flags.push("page-wide CSS");
    if ((row.startMs ?? 0) >= START_FLAG_MS) row.flags.push("slow start");
    if (row.handlerErrors > 0) row.flags.push("handler errors");
    rows.push(row);
  }
  return rows.sort((a, b) => b.loafMs - a.loafMs || (b.cssRules ?? 0) - (a.cssRules ?? 0) || a.id.localeCompare(b.id));
}

// --- script attribution -----------------------------------------------------------------

/** Maps a script URL to the plugin whose bundle it is, or BB core for anything else. `urls` maps a bundle path to its plugin id. */
export function ownerOf(sourceURL: string, urls: ReadonlyMap<string, string>, origin: string): string {
  if (!sourceURL) return CORE;
  const path = sourceURL.startsWith(origin) ? sourceURL.slice(origin.length) : sourceURL;
  const clean = path.split("?")[0].split("#")[0];
  const known = urls.get(clean);
  if (known) return known;
  // A plugin bundle the list does not know yet (just rebuilt or installed): keep it apart from BB core.
  const hash = hashOf(clean);
  return hash ? `plugin:${hash.slice(0, 8)}` : CORE;
}

/** The plugin id a stylesheet URL belongs to, by the hash in `/api/v1/plugin-app-assets/<hash>/`. */
export function hashOf(url: string): string | null {
  return /\/plugin-app-assets\/([0-9a-f]+)\//.exec(url)?.[1] ?? null;
}

/** What the reader was doing when a frame ran: the newest of typing and scroll within `quietMs`, a navigation settling, else idle. */
export function driverAt(
  t: number,
  last: { typing: number; scroll: number; nav: number; input: number },
  quietMs = 1000,
): Driver {
  if (t - last.nav <= quietMs && last.nav > 0) return "nav";
  if (t - last.typing <= quietMs && last.typing > 0) return "typing";
  if (t - last.scroll <= quietMs && last.scroll > 0) return "scroll";
  if (t - last.input <= quietMs && last.input > 0) return "other";
  return "idle";
}

// --- series for the charts ----------------------------------------------------------------

export interface Point {
  /** The bucket's start and end. */
  t0: number;
  t1: number;
  /** Null where the bucket holds no window (nothing measured, or the page was away). */
  frameP95: number | null;
  longest: number | null;
  typingP95: number | null;
  idlePct: number | null;
  heapMB: number | null;
  /** Script time inside long frames: BB's own code against all plugins together. */
  coreMs: number;
  pluginMs: number;
  loafN: number;
}

/** Splits the last `rangeMs` before `now` into `buckets` equal parts and merges the windows ending in each. */
export function series(windows: WindowLine[], now: number, rangeMs: number, buckets: number): Point[] {
  const size = rangeMs / buckets;
  const start = now - rangeMs;
  const groups: WindowLine[][] = Array.from({ length: buckets }, () => []);
  for (const w of windows) {
    if (w.t < start || w.t > now) continue;
    groups[Math.min(buckets - 1, Math.floor((w.t - start) / size))].push(w);
  }
  return groups.map((group, i) => {
    const m = mergeWindows(group);
    const seen = group.length > 0 && m.visibleMs > 0;
    let core = 0;
    let plugins = 0;
    for (const [id, o] of Object.entries(m.byPlugin)) {
      if (id === CORE) core += o.ms;
      else plugins += o.ms;
    }
    return {
      t0: start + i * size,
      t1: start + (i + 1) * size,
      frameP95: quantile(m.frame.hist, 0.95),
      longest: m.loaf.n ? m.loaf.worst : null,
      typingP95: histCount(m.input.typing) ? quantile(m.input.typing, 0.95) : null,
      idlePct: seen ? (m.idleBusyMs / m.visibleMs) * 100 : null,
      heapMB: m.heapMB,
      coreMs: core,
      pluginMs: plugins,
      loafN: m.loaf.n,
    };
  });
}

export interface Share {
  id: string;
  ms: number;
}

/** Script time per owner, largest first, keeping `keep` owners and folding the rest into "others". BB core is always kept. */
export function shares(byPlugin: Record<string, Owner>, keep: number): Share[] {
  const all = Object.entries(byPlugin)
    .filter(([, o]) => o.ms > 0)
    .map(([id, o]) => ({ id, ms: o.ms }))
    .sort((a, b) => b.ms - a.ms);
  const kept: Share[] = [];
  let rest = 0;
  for (const s of all) {
    if (kept.length < keep || s.id === CORE) kept.push(s);
    else rest += s.ms;
  }
  if (rest > 0) kept.push({ id: "others", ms: rest });
  return kept;
}

/** One plugin's script time per bucket, like `series`; null where the bucket holds no window. */
export function pluginSeries(windows: WindowLine[], id: string, now: number, rangeMs: number, buckets: number): (number | null)[] {
  const size = rangeMs / buckets;
  const start = now - rangeMs;
  const sums: (number | null)[] = new Array(buckets).fill(null);
  for (const w of windows) {
    if (w.t < start || w.t > now || w.visibleMs <= 0) continue;
    const i = Math.min(buckets - 1, Math.floor((w.t - start) / size));
    sums[i] = (sums[i] ?? 0) + (w.byPlugin[id]?.ms ?? 0);
  }
  return sums;
}

/** BB core's script time by what started it, largest first. */
export function coreKinds(byPlugin: Record<string, Owner>): { id: CallKind; label: string; ms: number }[] {
  const by = byPlugin[CORE]?.by ?? {};
  return CALL_KINDS.map((k) => ({ id: k.id, label: k.label, ms: by[k.id] ?? 0 }))
    .filter((k) => k.ms > 0)
    .sort((a, b) => b.ms - a.ms);
}

// --- class names behind page-wide rules -------------------------------------------------------

/** Undoes the CSS escapes of a class name as a selector writes it: `max-md\\:zed` is `max-md:zed`. */
export function unescapeClass(raw: string): string {
  return raw.replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\(.)/g, "$1");
}

/** The class a page-wide rule is for (the first one after the `:where(…)` scope), as written in the source: variants and all. */
export function classOfSelector(selector: string): string | null {
  const m = /\)\s+\.((?:\\.|[\w-])+)/.exec(selector);
  return m ? unescapeClass(m[1]) : null;
}

/** A class without its variants: `max-md:data-[state=open]:zed` is `zed`. Colons inside brackets belong to the utility. */
export function utilityOf(cls: string): string {
  let depth = 0;
  let cut = -1;
  for (let i = 0; i < cls.length; i++) {
    const c = cls[i];
    if (c === "[" || c === "(") depth++;
    else if (c === "]" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === ":" && depth === 0) cut = i;
  }
  return cut < 0 ? cls : cls.slice(cut + 1);
}

/** The bare word of a utility class and the variants before it: `max-md:hover:zed` is `zed` under `max-md:hover`. */
export function classParts(cls: string): { word: string; variant: string } {
  const word = utilityOf(cls);
  return { word, variant: cls.length > word.length ? cls.slice(0, cls.length - word.length - 1) : "" };
}

/** What a plugin's recorded class tallies say: a variant is stored as `name:` so the two kinds share one map. */
export function splitWords(entries: [string, number][]): { words: [string, number][]; variants: [string, number][] } {
  const words: [string, number][] = [];
  const variants: [string, number][] = [];
  for (const e of entries) (e[0].endsWith(":") ? variants : words).push(e);
  return { words, variants };
}
