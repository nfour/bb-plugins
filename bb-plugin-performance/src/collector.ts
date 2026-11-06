// bb-plugin-performance — the measuring, in the page.
//
// Everything here is cheap on purpose: observers only push into counters, no
// callback reads layout or writes the DOM, the frame sampler runs only while you
// scroll or type, and one 30-second timer does the rest. Aggregates go to the
// server once a minute (and when the tab goes to the background). While the
// plugin is off nothing is attached.
import {
  addSplit,
  addToHist,
  classParts,
  CORE,
  classOfSelector,
  driverAt,
  phasesOf,
  SITES_KEEP,
  topSites,
  emptyWindow,
  hashOf,
  kindOf,
  ownerOf,
  splitOf,
  type BenchLine,
  type CallKind,
  type CssLine,
  type Driver,
  type Line,
  type MarkLine,
  type NavLine,
  type ProbeLine,
  type SlowLine,
  type Split,
  type StartLine,
  type WindowLine,
} from "./model";
import { isAway } from "./page";

// --- the few browser types TypeScript's DOM library does not have yet -------------------

interface ScriptTiming {
  sourceURL: string;
  invokerType: string;
  invoker: string;
  duration: number;
  startTime: number;
  forcedStyleAndLayoutDuration: number;
  sourceFunctionName?: string;
  sourceCharPosition?: number;
}
interface LoafEntry extends PerformanceEntry {
  styleAndLayoutStart: number;
  blockingDuration: number;
  firstUIEventTimestamp: number;
  scripts: ScriptTiming[];
}
interface EventEntry extends PerformanceEntry {
  interactionId?: number;
  processingStart: number;
  processingEnd: number;
}
interface NavigateEvent extends Event {
  destination: { url: string; sameDocument: boolean };
}
interface NavigationApi {
  addEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
  removeEventListener(type: "navigate", listener: (event: NavigateEvent) => void): void;
}

export type Call = (method: "ingest", input: unknown) => Promise<unknown>;

export interface PluginInfo {
  id: string;
  version: string | null;
  calls: number;
  maxMs: number;
  errors: number;
}

export interface Live {
  enabled: boolean;
  session: string;
  window: WindowLine;
  /** Lines waiting for the next flush. */
  queued: Line[];
  css: Record<string, number>;
  startPluginMs: Record<string, number>;
  startSettled: number | null;
  /** The BB version, read from where its built-in plugins live. */
  bb: string | null;
  plugins: PluginInfo[];
  /** Plugins whose bundle this page can name in a slow frame. */
  known: number;
  heap: { t: number; mb: number }[];
  lastFlush: number | null;
  lastError: string | null;
  /** The class words behind each plugin's page-wide rules, most common first. */
  cssWords: Record<string, [string, number][]>;
  /** Script and stylesheet size per plugin, as the browser decoded them. */
  bundles: Record<string, { js: number; css: number }>;
  /** A probe or benchmark in progress: the dashboard shows it and the buttons wait. */
  busy: "probe" | "bench" | null;
  progress: { done: number; total: number } | null;
  lastProbe: ProbeLine | null;
  lastBench: BenchLine | null;
  /** The same benchmark with the plugin stylesheets switched off. */
  lastBenchOff: BenchLine | null;
  /** True while a benchmark runs with the plugin stylesheets off. */
  cssOffNow: boolean;
  /** The reader's own marks from this page, newest last. */
  marks: MarkLine[];
  /** Until when measuring is on hold (epoch ms), or 0. */
  pausedUntil: number;
}

/** What the benchmark needs from the page's router and the server's thread list. */
export interface BenchTools {
  ids: string[];
  rounds: number;
  /** Run with every other plugin's stylesheet switched off, to see what the plugins' CSS adds to a switch. */
  cssOff?: boolean;
  toThread: (id: string) => void;
  back: () => void;
}

const PLUGIN_ID = "performance";
const FLUSH_MS = 60_000;
const TICK_MS = 30_000;
const FRAME_WINDOW_MS = 400;
const START_WINDOW_MS = 10_000;
const SETTLE_QUIET_MS = 100;
const SETTLE_CAP_MS = 2_000;
const SLOW_MS = 100;
const SLOW_PER_WINDOW = 5;
const MAX_QUEUED = 200;
const HEAP_KEEP = 130;
const HISTORY_KEEP = 400;

const LAST_KEY = "performance:last";
const MARK_WINDOW_MS = 15_000;
const FRAMES_KEEP = 40;
const WORDS_KEEP = 8;

const r1 = (x: number) => Math.round(x * 10) / 10;

const TYPING = new Set(["keydown", "keyup", "keypress", "beforeinput", "input", "compositionend"]);
const CLICKS = new Set(["pointerdown", "pointerup", "click", "mousedown", "mouseup", "dblclick", "auxclick"]);

const newSession = () => `s_${Math.random().toString(36).slice(2, 8)}`;

function createCollector() {
  let enabled = false;
  let call: Call | null = null;
  let detach: (() => void) | null = null;
  let mountSignal: AbortSignal | null = null;

  const session = newSession();
  let win = emptyWindow(session, Date.now());
  let winStart = performance.now();
  let slowCandidates: SlowLine[] = [];
  let queued: Line[] = [];
  let css: Record<string, number> = {};
  let startPluginMs: Record<string, number> = {};
  let startSettled: number | null = null;
  let plugins: PluginInfo[] = [];
  let heap: { t: number; mb: number }[] = [];
  let lastFlush: number | null = null;
  let lastError: string | null = null;
  let bbVersion: string | null = null;
  let known = 0;
  let cssWords: Live["cssWords"] = {};
  let bundles: Live["bundles"] = {};
  let busy: Live["busy"] = null;
  /** Plugin stylesheets a comparison run has switched off; they always come back. */
  let offSheets: CSSStyleSheet[] = [];
  const restoreSheets = () => {
    for (const sheet of offSheets) sheet.disabled = false;
    offSheets = [];
  };
  let progress: Live["progress"] = null;
  let marks: MarkLine[] = [];
  let pausedUntil = 0;
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(LAST_KEY) ?? "{}") as { probe?: ProbeLine; bench?: BenchLine; benchOff?: BenchLine };
    } catch {
      return {};
    }
  })();
  let lastProbe: ProbeLine | null = saved.probe ?? null;
  let lastBench: BenchLine | null = saved.bench ?? null;
  let lastBenchOff: BenchLine | null = saved.benchOff ?? null;
  const remember = () => {
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify({ probe: lastProbe, bench: lastBench, benchOff: lastBenchOff }));
    } catch {
      // storage full or blocked: the result stays in memory
    }
  };
  /** Stretches of this page's own work (a probe) that its slow frames must not count. */
  const ignore: [number, number][] = [];
  const held = () => pausedUntil > Date.now();
  /** The last long frames, newest last: what "This lagged" reports. */
  const recentFrames: { at: number; ms: number; split: Split; owners: Record<string, number> }[] = [];
  const navListeners = new Set<(line: NavLine) => void>();
  /** The newest frame and event already counted: observers that attach again replay the browser's buffer, which must not count twice. */
  let loafSeen = -1;
  let eventSeen = -1;

  // The plugin bundle paths (and stylesheet hashes) to ids; filled from BB's own plugin list.
  let urls = new Map<string, string>();
  let hashes = new Map<string, string>();
  let ready: Promise<void> = Promise.resolve();

  const last = { typing: 0, scroll: 0, nav: 0, input: 0 };
  let visibleSince: number | null = null;
  let visibleAcc = 0;
  let eventBase = { keys: 0, clicks: 0 };
  let selfMs = 0;

  /** What this page has already sent, for the nav badge, which must not poll the server. */
  let history: Line[] = [];
  const flushListeners = new Set<() => void>();

  const listeners = new Set<() => void>();
  let notifyTimer: ReturnType<typeof setInterval> | null = null;

  const timed = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    const t = performance.now();
    try {
      fn(...args);
    } finally {
      selfMs += performance.now() - t;
    }
  };

  // --- plugin list -------------------------------------------------------------------

  async function refreshPlugins(): Promise<void> {
    try {
      const response = await fetch("/api/v1/plugins", { credentials: "same-origin" });
      if (!response.ok) throw new Error(`plugins ${response.status}`);
      const body = (await response.json()) as { plugins?: unknown[] } | unknown[];
      const list = (Array.isArray(body) ? body : body.plugins ?? []) as Record<string, any>[];
      const nextUrls = new Map<string, string>();
      const nextHashes = new Map<string, string>();
      const nextBundles: Live["bundles"] = {};
      const infos: PluginInfo[] = [];
      for (const p of list) {
        if (typeof p?.id !== "string") continue;
        const js = p.app?.bundle?.jsUrl;
        const cssUrl = p.app?.bundle?.cssUrl;
        if (typeof js === "string") nextUrls.set(js.split("?")[0], p.id);
        const hash = typeof cssUrl === "string" ? hashOf(cssUrl) : null;
        if (hash) nextHashes.set(hash, p.id);
        // BB's own list carries the size of each bundle; the browser's resource timings would do too, but their buffer fills at 250 entries.
        if (typeof p.app?.bundle?.jsBytes === "number") nextBundles[p.id] = { js: p.app.bundle.jsBytes, css: 0 };
        if (p.enabled && p.handlerStats) {
          infos.push({ id: p.id, version: typeof p.version === "string" ? p.version : null, calls: p.handlerStats.count ?? 0, maxMs: p.handlerStats.maxMs ?? 0, errors: p.handlerStats.errorCount ?? 0 });
        }
        // Built-in plugins live under .../app-versions/<bb version>/, the only place a page can read the version from.
        if (!bbVersion && typeof p.rootDir === "string") bbVersion = /app-versions\/([\d.]+)\//.exec(p.rootDir)?.[1] ?? null;
      }
      const changed = nextHashes.size !== hashes.size || [...nextHashes.keys()].some((h) => !hashes.has(h));
      urls = nextUrls;
      hashes = nextHashes;
      plugins = infos;
      bundles = nextBundles;
      known = nextUrls.size;
      if (changed) scheduleCss();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  // --- page-wide stylesheet rules ---------------------------------------------------------

  let cssQueued = false;
  function scheduleCss() {
    if (cssQueued || !enabled) return;
    cssQueued = true;
    const run = () => {
      cssQueued = false;
      if (enabled) countCss();
    };
    if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 5000 });
    else setTimeout(run, 2000);
  }

  function countCss() {
    const counts: Record<string, number> = {};
    const words: Record<string, Map<string, number>> = {};
    let total = 0;
    let current = "";
    const walk = (rules: CSSRuleList): number => {
      let n = 0;
      for (const rule of Array.from(rules)) {
        const selector = (rule as CSSStyleRule).selectorText;
        // `bb plugin build` scopes a utility class as `:where([data-bb-plugin=…], …) .name`, which matches on every element.
        if (selector && selector.startsWith(":where([data-bb-plugin") && /\)\s+\.[\w-]/.test(selector)) {
          n++;
          const cls = classOfSelector(selector);
          if (cls) {
            // `.max-md\:zed` is the class `max-md:zed`: tally its bare word, and its variant apart (stored as `max-md:`).
            const { word, variant } = classParts(cls);
            const into = (words[current] ??= new Map());
            into.set(word, (into.get(word) ?? 0) + 1);
            if (variant) into.set(`${variant}:`, (into.get(`${variant}:`) ?? 0) + 1);
          }
        } else if ((rule as CSSGroupingRule).cssRules) n += walk((rule as CSSGroupingRule).cssRules);
      }
      return n;
    };
    for (const sheet of Array.from(document.styleSheets)) {
      const hash = sheet.href ? hashOf(sheet.href) : null;
      if (!hash) continue;
      const id = hashes.get(hash) ?? `plugin:${hash.slice(0, 8)}`;
      current = id;
      try {
        const n = walk(sheet.cssRules);
        counts[id] = (counts[id] ?? 0) + n;
        total += n;
      } catch {
        // a sheet from another origin cannot be read
      }
    }
    css = counts;
    const top: NonNullable<CssLine["words"]> = {};
    cssWords = {};
    for (const [id, map] of Object.entries(words)) {
      const byCount = (a: [string, number], b: [string, number]) => b[1] - a[1] || a[0].localeCompare(b[0]);
      const all = [...map];
      const ranked = [...all.filter(([w]) => !w.endsWith(":")).sort(byCount).slice(0, WORDS_KEEP), ...all.filter(([w]) => w.endsWith(":")).sort(byCount).slice(0, WORDS_KEEP)];
      cssWords[id] = ranked;
      top[id] = Object.fromEntries(ranked);
    }
    const line: CssLine = { v: 1, t: Date.now(), kind: "css", session, cssRules: counts, total, words: top };
    queue(line);
  }

  // --- the window ---------------------------------------------------------------------

  function queue(line: Line) {
    queued.push(line);
    if (queued.length > MAX_QUEUED) queued.splice(0, queued.length - MAX_QUEUED);
  }

  function slow(line: SlowLine) {
    slowCandidates.push(line);
    slowCandidates.sort((a, b) => b.ms - a.ms);
    if (slowCandidates.length > SLOW_PER_WINDOW) slowCandidates.length = SLOW_PER_WINDOW;
  }

  const owner = (url: string) => ownerOf(url, urls, location.origin);

  /** Startup facts, read from the frames that ran before `START_WINDOW_MS`. */
  let startEnd = 0;
  let startFresh = false;

  function onLoaf(entries: PerformanceEntry[]) {
    for (const raw of entries) {
      const e = raw as LoafEntry;
      if (e.startTime <= loafSeen) continue;
      loafSeen = e.startTime;
      if (held() || ignore.some(([from, to]) => e.startTime < to && e.startTime + e.duration > from)) continue;
      // Frames while the page is still loading are start-up work, not idle cost.
      const loading = e.startTime < START_WINDOW_MS && performance.now() < START_WINDOW_MS * 2;
      const driver: Driver = e.firstUIEventTimestamp > 0 || loading ? "other" : driverAt(e.startTime, last);
      win.loaf.n++;
      win.loaf.blockingMs += e.blockingDuration;
      win.loaf.worst = Math.max(win.loaf.worst, e.duration);
      win.loaf.byDriver[driver]++;
      if (driver === "idle") win.idleBusyMs += e.duration;
      const split = splitOf(e);
      addSplit((win.split ??= splitOf({ duration: 0, startTime: 0, styleAndLayoutStart: 0, scripts: [] })), split);
      const owners = new Map<string, { ms: number; inv: string; forced: number; by: Partial<Record<CallKind, number>> }>();
      for (const s of e.scripts) {
        const who = owner(s.sourceURL);
        const kind = kindOf(s.invokerType, s.invoker ?? "");
        let at = owners.get(who);
        if (!at) owners.set(who, (at = { ms: 0, inv: s.invokerType, forced: 0, by: {} }));
        at.ms += s.duration;
        at.forced += s.forcedStyleAndLayoutDuration ?? 0;
        if ((s.forcedStyleAndLayoutDuration ?? 0) >= 1) {
          // Where in the bundle the layout was forced: function and character position (no source maps, but stable per version).
          const file = who === CORE ? `${s.sourceURL.split("?")[0].split("/").pop()} ` : "";
          const site = `${who} · ${file}${s.sourceFunctionName || s.invoker || s.invokerType}${s.sourceCharPosition != null && s.sourceCharPosition >= 0 ? `@${s.sourceCharPosition}` : ""}`;
          const sites = (win.sites ??= {});
          const here = (sites[site] ??= { ms: 0, n: 0 });
          here.ms += s.forcedStyleAndLayoutDuration;
          here.n++;
          if (Object.keys(sites).length > SITES_KEEP * 4) {
            for (const [k] of topSites(sites, Object.keys(sites).length).slice(SITES_KEEP * 2)) delete sites[k];
          }
        }
        at.by[kind] = (at.by[kind] ?? 0) + s.duration;
        if (startFresh && e.startTime < START_WINDOW_MS && s.invokerType === "module-script" && who !== CORE) startPluginMs[who] = (startPluginMs[who] ?? 0) + s.duration;
      }
      for (const [who, o] of owners) {
        const into = (win.byPlugin[who] ??= { ms: 0, n: 0 });
        into.ms += o.ms;
        into.n++;
        if (o.forced > 0) into.forced = (into.forced ?? 0) + o.forced;
        into.by ??= {};
        for (const [k, v] of Object.entries(o.by)) into.by[k as CallKind] = (into.by[k as CallKind] ?? 0) + (v ?? 0);
      }
      if (startFresh && e.startTime < START_WINDOW_MS) startEnd = Math.max(startEnd, e.startTime + e.duration);
      if (e.duration >= SLOW_MS) {
        const at = Date.now() - Math.max(0, performance.now() - e.startTime);
        const top = (o: { by: Partial<Record<CallKind, number>> }) => (Object.entries(o.by).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]?.[0] ?? "other") as CallKind;
        slow({
          v: 1,
          t: at,
          kind: "slow",
          session,
          what: "loaf",
          ms: Math.round(e.duration),
          blocking: Math.round(e.blockingDuration),
          driver,
          scripts: [...owners]
            .sort((a, b) => b[1].ms - a[1].ms)
            .slice(0, 4)
            .map(([who, o]) => ({ owner: who, ms: Math.round(o.ms), inv: o.inv, ...(o.forced >= 1 ? { forced: Math.round(o.forced) } : {}), kind: top(o) })),
          split: { frameMs: Math.round(split.frameMs), scriptMs: Math.round(split.scriptMs), forcedMs: Math.round(split.forcedMs), styleMs: Math.round(split.styleMs), otherMs: Math.round(split.otherMs) },
        });
      }
      if (e.duration >= SLOW_MS / 2) {
        recentFrames.push({ at: e.startTime + e.duration, ms: e.duration, split, owners: Object.fromEntries([...owners].map(([who, o]) => [who, o.ms])) });
        if (recentFrames.length > FRAMES_KEEP) recentFrames.shift();
      }
    }
  }

  function onEvents(entries: PerformanceEntry[]) {
    if (held()) return;
    for (const raw of entries) {
      const e = raw as EventEntry;
      if (e.startTime <= eventSeen) continue;
      eventSeen = e.startTime;
      if (!e.interactionId) continue;
      const kind = TYPING.has(e.name) ? "typing" : CLICKS.has(e.name) ? "click" : null;
      if (!kind) continue;
      addToHist(win.input[kind], e.duration);
      win.input.worst = Math.max(win.input.worst, e.duration);
      if (e.duration >= SLOW_MS) {
        // The frames that ran during the input arrive a moment apart from it, so who ran is read once they have.
        const from = e.startTime;
        const to = e.startTime + e.duration;
        const phases = phasesOf(e);
        const t = Date.now();
        const ms = Math.round(e.duration);
        setTimeout(() => {
          if (!enabled) return;
          const by: Record<string, number> = {};
          for (const f of recentFrames) if (f.at >= from && f.at - f.ms <= to) for (const [who, v] of Object.entries(f.owners)) by[who] = (by[who] ?? 0) + v;
          const scripts = Object.entries(by)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([owner, v]) => ({ owner, ms: Math.round(v), inv: "frame" }));
          slow({ v: 1, t, kind: "slow", session, what: "input", ms, blocking: 0, driver: kind === "typing" ? "typing" : "other", scripts, phases });
        }, 300);
      }
    }
  }

  function counts() {
    const map = (performance as Performance & { eventCounts?: Map<string, number> }).eventCounts;
    return { keys: map?.get("keydown") ?? 0, clicks: map?.get("click") ?? 0 };
  }

  function closeWindow(): WindowLine | null {
    const now = performance.now();
    if (visibleSince != null) {
      visibleAcc += now - visibleSince;
      visibleSince = now;
    }
    const c = counts();
    win.t = Date.now();
    win.dur = Math.round(now - winStart);
    win.visibleMs = Math.round(visibleAcc);
    win.input.keys = Math.max(0, c.keys - eventBase.keys);
    win.input.clicks = Math.max(0, c.clicks - eventBase.clicks);
    win.selfMs = Math.round(selfMs * 10) / 10;
    win.heapMB = heap.length ? heap[heap.length - 1].mb : null;
    if (win.split) for (const k of Object.keys(win.split) as (keyof Split)[]) win.split[k] = r1(win.split[k]);
    if (win.sites) win.sites = Object.fromEntries(topSites(win.sites).map(([k, v]) => [k, { ms: r1(v.ms), n: v.n }]));
    for (const o of Object.values(win.byPlugin)) {
      o.ms = r1(o.ms);
      if (o.forced) o.forced = r1(o.forced);
      for (const k of Object.keys(o.by ?? {}) as CallKind[]) o.by![k] = r1(o.by![k] ?? 0);
    }
    const done = win;
    const empty = done.visibleMs === 0 && done.loaf.n === 0 && done.input.keys === 0 && done.input.clicks === 0;
    win = emptyWindow(session, Date.now());
    winStart = now;
    visibleAcc = 0;
    eventBase = c;
    selfMs = 0;
    for (const s of slowCandidates) queue(s);
    slowCandidates = [];
    return empty ? null : done;
  }

  let flushing: Promise<void> | null = null;

  /** One flush at a time: two in flight would send the same queued lines twice. */
  function flush(): Promise<void> {
    flushing ??= send().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  async function send(): Promise<void> {
    if (!call) return;
    const done = closeWindow();
    if (done) queue(done);
    if (queued.length === 0) return;
    const lines = queued.slice(0, MAX_QUEUED);
    try {
      await call("ingest", {
        lines,
        bb: bbVersion,
        plugins: plugins.map((p) => ({ id: p.id, version: p.version, calls: p.calls, maxMs: p.maxMs, errors: p.errors })),
      });
      queued = queued.filter((l) => !lines.includes(l));
      history.push(...lines);
      if (history.length > HISTORY_KEEP) history.splice(0, history.length - HISTORY_KEEP);
      for (const fn of flushListeners) fn();
      lastFlush = Date.now();
      lastError = null;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  // --- frame sampler: runs only while you scroll or type --------------------------------

  let rafId = 0;
  let prevFrame = 0;

  function frame(t: number) {
    rafId = 0;
    if (!enabled || isAway() || held()) {
      prevFrame = 0;
      return;
    }
    if (prevFrame > 0) {
      const gap = t - prevFrame;
      addToHist(win.frame.hist, gap);
      win.frame.worst = Math.max(win.frame.worst, gap);
    }
    prevFrame = t;
    if (t - last.input > FRAME_WINDOW_MS) {
      prevFrame = 0;
      return;
    }
    rafId = requestAnimationFrame(timed(frame));
  }

  function activity(kind: "typing" | "scroll" | "input") {
    const now = performance.now();
    last.input = now;
    if (kind === "typing") last.typing = now;
    else if (kind === "scroll") last.scroll = now;
    if (!rafId && !isAway()) rafId = requestAnimationFrame(timed(frame));
  }

  // --- navigation and panel settling ------------------------------------------------------

  let settling: { stop(): void } | null = null;

  function watchSettle(what: NavLine["what"], route: string) {
    if (settling || held()) return;
    const t0 = performance.now();
    last.nav = t0;
    let lastMutation = t0;
    let changed = false;
    const observer = new MutationObserver(
      timed(() => {
        lastMutation = performance.now();
        changed = true;
      }),
    );
    observer.observe(document.body, { childList: true, subtree: true });
    const finish = () => {
      clearInterval(poll);
      observer.disconnect();
      settling = null;
      const now = performance.now();
      const capped = now - t0 >= SETTLE_CAP_MS;
      if (!changed) return;
      const rows = document.querySelectorAll("[data-timeline-row-id]").length;
      const line: NavLine = {
        v: 1,
        t: Date.now(),
        kind: "nav",
        session,
        what,
        ms: Math.round(capped ? now - t0 : lastMutation - t0),
        settled: !capped,
        rows,
        virtualized: document.querySelector("[data-timeline-window-spacer]") != null,
        route,
      };
      queue(line);
      for (const fn of navListeners) fn(line);
    };
    const poll = setInterval(
      timed(() => {
        const now = performance.now();
        if (now - lastMutation >= SETTLE_QUIET_MS || now - t0 >= SETTLE_CAP_MS) finish();
      }),
      50,
    );
    settling = { stop: finish };
  }

  /** `/thread/thr_x/...` and the like become `thread`; the id is dropped so no title or id reaches the file. */
  function routeOf(url: string): { route: string; thread: boolean } {
    let path = "";
    try {
      path = new URL(url, location.origin).pathname;
    } catch {
      return { route: "", thread: false };
    }
    const thread = /\/thr_[a-z0-9]+/i.test(path);
    return { route: path.replace(/thr_[a-z0-9]+/gi, "thr").replace(/proj_[a-z0-9]+/gi, "proj").slice(0, 80), thread };
  }

  // --- attach and detach -------------------------------------------------------------------

  function attach() {
    if (detach) return;
    const cleanups: (() => void)[] = [];
    cleanups.push(restoreSheets);
    const on = (target: EventTarget, type: string, fn: EventListener, options: AddEventListenerOptions = {}) => {
      target.addEventListener(type, fn, options);
      cleanups.push(() => target.removeEventListener(type, fn, options));
    };

    startFresh = performance.now() < START_WINDOW_MS;
    startEnd = 0;
    startPluginMs = {};
    eventBase = counts();
    visibleSince = isAway() ? null : performance.now();
    visibleAcc = 0;
    winStart = performance.now();
    ready = refreshPlugins();

    // Slow frames and interactions. Entries wait for the plugin list so their scripts can be named.
    const observe = (type: string, handler: (entries: PerformanceEntry[]) => void, extra: PerformanceObserverInit = {}) => {
      if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return;
      const observer = new PerformanceObserver(
        timed((list) => {
          const entries = list.getEntries();
          const wait = known > 0 ? Promise.resolve() : Promise.race([ready, new Promise((r) => setTimeout(r, 3000))]);
          void wait.then(timed(() => enabled && handler(entries)));
        }),
      );
      observer.observe({ type, ...extra } as PerformanceObserverInit);
      cleanups.push(() => observer.disconnect());
    };
    observe("long-animation-frame", onLoaf, { buffered: true });
    observe("event", onEvents, { durationThreshold: 16 } as PerformanceObserverInit);

    let fcp: number | null = null;
    if (PerformanceObserver.supportedEntryTypes?.includes("paint")) {
      const paints = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) if (e.name === "first-contentful-paint") fcp = e.startTime;
      });
      paints.observe({ type: "paint", buffered: true });
      cleanups.push(() => paints.disconnect());
    }

    // What you were doing, for the frame sampler and for naming the driver of a slow frame.
    const passive = { passive: true, capture: true };
    on(document, "keydown", () => activity("typing"), passive);
    on(document, "wheel", () => activity("scroll"), passive);
    on(document, "scroll", () => activity("scroll"), passive);
    on(document, "touchmove", () => activity("scroll"), passive);
    on(document, "pointerdown", () => activity("input"), passive);

    on(document, "visibilitychange", () => {
      const now = performance.now();
      if (isAway()) {
        if (visibleSince != null) visibleAcc += now - visibleSince;
        visibleSince = null;
        void flush();
      } else {
        visibleSince = now;
        void refreshPlugins();
      }
    });

    // Best effort: a reload or close sends what the minute timer has not yet.
    on(window, "pagehide", () => void flush());

    // A route change that stays in the page: a thread switch, or another page of BB.
    const nav = (window as Window & { navigation?: NavigationApi }).navigation;
    if (nav) {
      const onNavigate = timed((event: NavigateEvent) => {
        if (!event.destination.sameDocument) return;
        const next = routeOf(event.destination.url);
        // The route drops ids, so two threads look alike: compare the real paths.
        if (new URL(event.destination.url, location.origin).pathname === location.pathname) return;
        watchSettle(next.thread ? "thread-switch" : "page", next.route);
      });
      nav.addEventListener("navigate", onNavigate);
      cleanups.push(() => nav.removeEventListener("navigate", onNavigate));
    }

    // The right panel opening: its size goes from 0 to something. The browser filters by attribute, so this costs nothing otherwise.
    const panels = new MutationObserver(
      timed((records) => {
        for (const r of records) {
          if (r.attributeName !== "data-panel-size" || !(r.target instanceof Element)) continue;
          const before = r.oldValue;
          const after = r.target.getAttribute("data-panel-size");
          if ((before === "0" || before == null) && after && after !== "0" && r.target.id.startsWith("thread-detail-secondary-panel")) watchSettle("panel-open", routeOf(location.href).route);
        }
      }),
    );
    panels.observe(document.body, { attributes: true, attributeFilter: ["data-panel-size"], attributeOldValue: true, subtree: true });
    cleanups.push(() => panels.disconnect());

    // One slow timer: heap, the plugin list, and the flush.
    let ticks = 0;
    const timer = setInterval(
      timed(() => {
        ticks++;
        const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
        if (memory && !isAway()) {
          heap.push({ t: Date.now(), mb: Math.round(memory.usedJSHeapSize / 104857.6) / 10 });
          if (heap.length > HEAP_KEEP) heap.splice(0, heap.length - HEAP_KEEP);
        }
        if (ticks % (FLUSH_MS / TICK_MS) === 0) {
          void (async () => {
            if (!isAway()) await refreshPlugins();
            await flush();
          })();
        }
      }),
      TICK_MS,
    );
    cleanups.push(() => clearInterval(timer));

    // Cold start: read once, ten seconds after load, only for a page that was just loaded.
    let startTimer: ReturnType<typeof setTimeout> | null = null;
    if (startFresh) {
      startTimer = setTimeout(
        timed(() => {
          const nav0 = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          startSettled = Math.round(startEnd || fcp || 0) || null;
          const line: StartLine = {
            v: 1,
            t: Date.now(),
            kind: "start",
            session,
            fcp: fcp == null ? null : Math.round(fcp),
            settled: startSettled ?? 0,
            domContentLoaded: nav0 ? Math.round(nav0.domContentLoadedEventEnd) : null,
            load: nav0 && nav0.loadEventEnd > 0 ? Math.round(nav0.loadEventEnd) : null,
            pluginMs: Object.fromEntries(Object.entries(startPluginMs).map(([k, v]) => [k, Math.round(v)])),
          };
          queue(line);
        }),
        Math.max(0, START_WINDOW_MS - performance.now()),
      );
      cleanups.push(() => startTimer && clearTimeout(startTimer));
    }
    scheduleCss();

    detach = () => {
      for (const fn of cleanups.splice(0).reverse()) fn();
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      prevFrame = 0;
      settling?.stop();
      settling = null;
      detach = null;
    };
  }

  function apply() {
    if (enabled && call) attach();
    else if (detach) {
      void flush().finally(() => detach?.());
    }
  }

  const snapshotLive = (): Live => {
    const live = JSON.parse(JSON.stringify(win)) as WindowLine;
    const now = performance.now();
    live.dur = Math.round(now - winStart);
    live.visibleMs = Math.round(visibleAcc + (visibleSince != null ? now - visibleSince : 0));
    const c = counts();
    live.input.keys = Math.max(0, c.keys - eventBase.keys);
    live.input.clicks = Math.max(0, c.clicks - eventBase.clicks);
    live.selfMs = Math.round(selfMs * 10) / 10;
    return {
      enabled,
      session,
      window: live,
      queued: [...queued, ...slowCandidates],
      css,
      startPluginMs,
      startSettled,
      plugins,
      known,
      heap,
      lastFlush,
      lastError,
      cssWords,
      bb: bbVersion,
      bundles,
      busy,
      progress,
      lastProbe,
      lastBench,
      lastBenchOff,
      cssOffNow: offSheets.length > 0,
      marks,
      pausedUntil: held() ? pausedUntil : 0,
    };
  };

  let cached: Live = snapshotLive();

  return {
    /** Called by the settings reader (src/Loader.tsx): whether to measure, and how to reach the server. */
    configure(next: { enabled: boolean; call: Call }) {
      call = next.call;
      enabled = next.enabled;
      apply();
      emit();
    },
    /** The content script's mount: when the page unloads or the plugin is replaced, everything is let go. */
    mount(signal: AbortSignal) {
      mountSignal = signal;
      return () => {
        enabled = false;
        if (detach) void flush().finally(() => detach?.());
        mountSignal = null;
        if (notifyTimer) clearInterval(notifyTimer);
        notifyTimer = null;
      };
    },
    getLive: () => cached,
    getHistory: () => history,
    /** Calls `fn` after each successful flush (about once a minute); costs nothing between. */
    onFlush(fn: () => void) {
      flushListeners.add(fn);
      return () => void flushListeners.delete(fn);
    },
    refresh: () => {
      void refreshPlugins().then(emit);
    },
    /** "This lagged": keeps what the last seconds looked like, and sends it now. */
    async mark() {
      if (!enabled) return null;
      const now = performance.now();
      const frames = recentFrames.filter((f) => now - f.at <= MARK_WINDOW_MS);
      const split = frames.reduce((acc, f) => addSplit(acc, f.split), splitOf({ duration: 0, startTime: 0, styleAndLayoutStart: 0, scripts: [] }));
      const owners: Record<string, number> = {};
      for (const f of frames) for (const [who, ms] of Object.entries(f.owners)) owners[who] = r1((owners[who] ?? 0) + ms);
      for (const k of Object.keys(split) as (keyof Split)[]) split[k] = r1(split[k]);
      const line: MarkLine = {
        v: 1,
        t: Date.now(),
        kind: "mark",
        session,
        route: routeOf(location.href).route,
        frames: frames.length,
        worst: Math.round(frames.reduce((m, f) => Math.max(m, f.ms), 0)),
        split,
        owners,
        elements: document.getElementsByTagName("*").length,
      };
      queue(line);
      marks = [...marks, line].slice(-10);
      emit();
      await flush();
      return line;
    },
    /** Stops measuring for `ms`; what is already gathered is kept. 0 resumes. */
    pause(ms: number) {
      pausedUntil = ms > 0 ? Date.now() + ms : 0;
      if (ms > 0) setTimeout(emit, ms + 50);
      emit();
    },
    /** One full style recalculation with each plugin's stylesheet switched off in turn, the page frozen for a moment each. */
    async probe(): Promise<ProbeLine | null> {
      if (busy || !enabled) return null;
      busy = "probe";
      progress = { done: 0, total: 0 };
      emit();
      try {
        await ready;
        const sheets = new Map<string, CSSStyleSheet[]>();
        for (const sheet of Array.from(document.styleSheets)) {
          const hash = sheet.href ? hashOf(sheet.href) : null;
          if (!hash) continue;
          const id = hashes.get(hash) ?? `plugin:${hash.slice(0, 8)}`;
          sheets.set(id, [...(sheets.get(id) ?? []), sheet]);
        }
        const ids = [...sheets.keys()];
        progress = { done: 0, total: ids.length + 1 };
        const recalc = () => {
          const t = performance.now();
          // Style only: reading a computed colour makes the browser recalculate styles but not lay the page out, so a plugin whose own screen is open is not charged for re-laying it out.
          void getComputedStyle(document.body).color;
          return performance.now() - t;
        };
        const flip = (list: CSSStyleSheet[], off: boolean) => {
          for (const sheet of list) sheet.disabled = off;
        };
        // Everything below runs in one task per measurement, so the page is never painted half-switched.
        const measure = (list: CSSStyleSheet[], reps: number) => {
          const costs: number[] = [];
          const withs: number[] = [];
          const withouts: number[] = [];
          try {
            for (let i = 0; i < reps; i++) {
              flip(list, true);
              const without = recalc();
              flip(list, false);
              const withIt = recalc();
              costs.push(withIt - without);
              withs.push(withIt);
              withouts.push(without);
            }
          } finally {
            flip(list, false);
          }
          const mid = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
          return { cost: mid(costs), withIt: mid(withs), without: mid(withouts) };
        };
        const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 30));
        const from = performance.now();
        const mine: [number, number] = [from, Number.POSITIVE_INFINITY];
        ignore.push(mine);
        if (ignore.length > 5) ignore.shift();
        recalc();
        const all = [...sheets.values()].flat();
        const total = measure(all, 3);
        const perPlugin: ProbeLine["perPlugin"] = {};
        let rules = 0;
        for (const id of ids) {
          await tick();
          // Elements the plugin has on screen are restyled too when its sheet goes off, so they are counted beside the time.
          const own = document.querySelectorAll(`[data-bb-plugin="${CSS.escape(id)}"] *`).length;
          perPlugin[id] = { ms: r1(Math.max(0, measure(sheets.get(id)!, 3).cost)), rules: css[id] ?? 0, own };
          rules += css[id] ?? 0;
          progress = { done: (progress?.done ?? 0) + 1, total: ids.length + 1 };
          emit();
        }
        const line: ProbeLine = {
          v: 1,
          t: Date.now(),
          kind: "probe",
          session,
          elements: document.getElementsByTagName("*").length,
          rules,
          baseMs: r1(total.withIt),
          withoutMs: r1(total.without),
          perPlugin,
        };
        queue(line);
        lastProbe = line;
        remember();
        return line;
      } finally {
        for (const range of ignore) if (!Number.isFinite(range[1])) range[1] = performance.now() + 100;
        busy = null;
        progress = null;
        emit();
      }
    },
    /** Switches between threads `rounds` times and times each switch; the first hop only warms things up and is dropped. */
    async bench(tools: BenchTools): Promise<BenchLine | null> {
      if (busy || !enabled || tools.ids.length < 2) return null;
      busy = "bench";
      const sequence: string[] = [];
      for (let r = 0; r < tools.rounds; r++) for (const id of tools.ids) sequence.push(id);
      progress = { done: 0, total: sequence.length };
      emit();
      const hops: number[] = [];
      // Every plugin sheet but this plugin's own (the dashboard stays readable) goes off for the run and always comes back.
      if (tools.cssOff) {
        for (const sheet of Array.from(document.styleSheets)) {
          const hash = sheet.href ? hashOf(sheet.href) : null;
          if (hash && hashes.get(hash) !== PLUGIN_ID && !sheet.disabled) offSheets.push(sheet);
        }
        for (const sheet of offSheets) sheet.disabled = true;
      }
      try {
        for (const id of sequence) {
          if (location.pathname.includes(id)) {
            progress = { done: (progress?.done ?? 0) + 1, total: sequence.length };
            continue;
          }
          const settled = new Promise<NavLine | null>((resolve) => {
            const fn = (line: NavLine) => {
              if (line.what !== "thread-switch") return;
              navListeners.delete(fn);
              clearTimeout(timer);
              resolve(line);
            };
            const timer = setTimeout(() => {
              navListeners.delete(fn);
              resolve(null);
            }, 5000);
            navListeners.add(fn);
          });
          tools.toThread(id);
          const line = await settled;
          if (line) hops.push(line.ms);
          progress = { done: (progress?.done ?? 0) + 1, total: sequence.length };
          emit();
          await new Promise((r) => setTimeout(r, 400));
        }
      } finally {
        restoreSheets();
        tools.back();
        busy = null;
        progress = null;
      }
      const timed1 = hops.slice(1);
      if (timed1.length === 0) {
        emit();
        return null;
      }
      const sorted = [...timed1].sort((a, b) => a - b);
      const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
      const line: BenchLine = {
        v: 1,
        t: Date.now(),
        kind: "bench",
        session,
        threads: tools.ids.length,
        rounds: tools.rounds,
        hops: timed1,
        median: at(0.5),
        p95: at(0.95),
        plugins: plugins.length,
        ...(tools.cssOff ? { cssOff: true } : {}),
      };
      queue(line);
      if (tools.cssOff) lastBenchOff = line;
      else lastBench = line;
      remember();
      emit();
      return line;
    },
    restoreSheets,
    flushNow: () => flush().then(emit),
    subscribe(fn: () => void) {
      listeners.add(fn);
      // A once-a-second refresh of the dashboard's numbers, only while something watches them.
      if (!notifyTimer) notifyTimer = setInterval(emit, 1000);
      cached = snapshotLive();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0 && notifyTimer) {
          clearInterval(notifyTimer);
          notifyTimer = null;
        }
      };
    },
    get aborted() {
      return mountSignal?.aborted ?? false;
    },
  };

  function emit() {
    cached = snapshotLive();
    for (const fn of listeners) fn();
  }
}

export const collector = createCollector();
