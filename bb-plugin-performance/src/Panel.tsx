import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ElementType, type ReactNode } from "react";
import { experimental_Icon as Icon, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { collector, type Live } from "./collector";
import {
  boundOf,
  CALL_KINDS,
  coreKinds,
  CORE,
  heapSlope,
  measures,
  mergeWindows,
  pluginRows,
  pluginSeries,
  series,
  shares,
  START_FLAG_MS,
  CSS_RULE_FLAG,
  TARGETS,
  toneOf,
  worstGap,
  type Bound,
  type Line,
  type MarkLine,
  type Measure,
  type NavLine,
  type PluginRow,
  type ProbeLine,
  type ServerLine,
  type SlowLine,
  type StartLine,
  type WindowLine,
  phaseBound,
  splitWords,
  topSites,
} from "./model";
import { Bars, Chart, clock, hueOf, Gauge, HistChart, Meter, Scatter, shareParts, short, Stack, Trend, type Mark } from "./charts";
import { useOptions } from "./options";
import { buildReport, type ReportPlugin } from "./report";
import { isAway } from "./page";

// The element name is built in two pieces: `bb plugin build` would read the bare word as a utility class (see AGENTS.md).
const Grid = ("tab" + "le") as unknown as ElementType;

const RANGES = [
  { id: "15m", label: "15 minutes", ms: 15 * 60_000 },
  { id: "1h", label: "1 hour", ms: 60 * 60_000 },
] as const;

const POLL_MS = 5000;

type Snapshot = Awaited<ReturnType<ReturnType<typeof useRpc<typeof rpcContract>>["call"]>> & {
  recent: Line[];
  server: ServerLine | null;
  dir: string;
  files: number;
  lastWriteError: string | null;
};

function useLive(): Live {
  return useSyncExternalStore(collector.subscribe, collector.getLive);
}

/** The server's snapshot, asked for again every few seconds while the dashboard is open and the tab is on screen. */
function useSnapshot() {
  const rpc = useRpc<typeof rpcContract>();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const load = () => {
      if (isAway()) return;
      rpc
        .call("snapshot", {})
        .then((s) => {
          if (stopped) return;
          setSnapshot(s as unknown as Snapshot);
          setError(null);
        })
        .catch((e: unknown) => !stopped && setError(e instanceof Error ? e.message : String(e)));
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [rpc]);
  return { snapshot, error };
}

const key = (l: Line) => `${l.kind}:${l.t}:${"session" in l ? l.session : ""}`;

function fmt(value: number | null, unit: Measure["unit"]): string {
  if (value == null) return "no data";
  const shown = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${unit}`;
}

function signed(value: number | null, unit: Measure["unit"]): string {
  if (value == null) return "";
  const shown = Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown > 0 ? "+" : ""}${shown} ${unit}`;
}

/** The figures the dashboard and the badge both read from a set of lines. */
export function compute(lines: Line[], heap: { t: number; mb: number }[], now: number, rangeMs: number) {
  const inRange = lines.filter((l) => l.t >= now - rangeMs);
  const windows = inRange.filter((l): l is WindowLine => l.kind === "window");
  const navs = inRange.filter((l): l is NavLine => l.kind === "nav");
  const start = [...lines].reverse().find((l): l is StartLine => l.kind === "start");
  const merged = mergeWindows(windows);
  const rows = measures(
    merged,
    {
      // A switch still changing at the cap is a floor, not a measure.
      switches: navs.filter((n) => n.what === "thread-switch" && n.settled).map((n) => n.ms),
      panels: navs.filter((n) => n.what === "panel-open" && n.settled).map((n) => n.ms),
    },
    { settled: start && start.settled > 0 ? start.settled : null },
    heapSlope(heap),
  );
  return { inRange, windows, merged, rows, navs, start };
}

/** The nav badge: the biggest gap as a multiple of its target, from what this page has already sent. */
export function useBadge() {
  const [, bump] = useState(0);
  useEffect(() => collector.onFlush(() => bump((n) => n + 1)), []);
  const live = collector.getLive();
  const { rows } = compute(collector.getHistory(), live.heap, Date.now(), RANGES[0].ms);
  const worst = worstGap(rows);
  if (!worst || worst.value == null) return null;
  const ratio = worst.value / worst.target;
  return {
    text: `${ratio >= 10 ? Math.round(ratio) : Math.round(ratio * 10) / 10}×`,
    tone: ratio > 2 ? ("critical" as const) : ("warning" as const),
    label: `${worst.label}: ${fmt(worst.value, worst.unit)}, target ${worst.target} ${worst.unit}`,
  };
}

const toneOfMs = (ms: number): Mark["tone"] => (ms >= 250 ? "bad" : ms >= 100 ? "warn" : "good");

function MetricCards({ rows }: { rows: Measure[] }) {
  return (
    <div className="perf-metrics">
      {rows.map((r) => (
        <div className="perf-metric" data-tone={r.tone} key={r.id} title={r.how}>
          <div className="perf-metric-top">
            <span className="perf-metric-label">{r.label}</span>
            <span className="perf-dim">{r.n ? `${r.n} ${r.n === 1 ? "sample" : "samples"}` : ""}</span>
          </div>
          <div className="perf-metric-value" title={r.capped ? "The slowest bucket the histogram keeps, so the true value is at least this" : undefined}>{r.capped ? "≥ " : ""}{fmt(r.value, r.unit)}</div>
          <Gauge value={r.value} target={r.target} tone={r.tone} />
          <div className="perf-metric-meta">
            <span>target {r.target} {r.unit}</span>
            {r.gap != null && <b data-tone={r.tone}>{r.tone === "good" ? "within" : `${signed(r.gap, r.unit)} over`}</b>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Hero({ rows, range, setRange, live, minutes }: { rows: Measure[]; range: string; setRange(id: (typeof RANGES)[number]["id"]): void; live: Live; minutes: number }) {
  const measured = rows.filter((r) => r.tone !== "none");
  const within = measured.filter((r) => r.tone === "good").length;
  const worst = worstGap(rows);
  return (
    <div className="perf-hero">
      <div className="perf-score">
        <div className="perf-score-number">
          {within}
          <span className="perf-dim"> / {measured.length}</span>
        </div>
        <div className="perf-score-label">metrics within target</div>
        <div className="perf-score-dots" aria-hidden="true">
          {rows.map((r) => (
            <i className="perf-tone" data-tone={r.tone} key={r.id} title={`${r.label}: ${fmt(r.value, r.unit)}`} />
          ))}
        </div>
      </div>
      <div className="perf-hero-side">
        <div className="perf-segments" role="group" aria-label="Period">
          {RANGES.map((r) => (
            <button type="button" key={r.id} className="perf-segment" data-on={range === r.id || undefined} onClick={() => setRange(r.id)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="perf-dim">{live.enabled ? `Measuring · ${minutes} min of this period on screen` : "Not measuring"}</div>
        {worst && worst.value != null ? (
          <div className="perf-worst">
            Biggest gap: <b>{worst.label}</b>, {fmt(worst.value, worst.unit)} against {worst.target} {worst.unit} ({short(worst.value / worst.target)}×)
          </div>
        ) : (
          <div className="perf-worst">{measured.length ? "Nothing over its target." : "Use BB for a minute: scroll, type, switch threads."}</div>
        )}
      </div>
    </div>
  );
}

const BOUND_LABEL: Record<Bound, string> = { script: "script-bound", render: "render-bound", other: "other tasks" };

const bytes = (n: number) => (n >= 1048576 ? `${short(n / 1048576)} MB` : `${Math.round(n / 1024)} KB`);

const ago = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
};

/** Things to do on the page: time a thread switch the same way each run, probe the style cost, mark a lag, pause, copy a report. */
function Actions({ live, report }: { live: Live; report: () => string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [note, setNote] = useState<string | null>(null);
  const say = (text: string) => {
    setNote(text);
    setTimeout(() => setNote((n) => (n === text ? null : n)), 6000);
  };
  const held = live.pausedUntil > Date.now();
  const idle = live.busy == null && live.enabled;

  const bench = async () => {
    try {
      const { ids } = (await rpc.call("recent_threads", { limit: 6 })) as { ids: string[] };
      if (ids.length < 2) return say("The benchmark needs at least two threads.");
      const line = await collector.bench({ ids, rounds: 3, toThread: (id) => void navigate.toThread(id), back: () => void navigate.toPluginPanel("performance") });
      say(line ? `Thread switches: median ${line.median} ms, 95th percentile ${line.p95} ms.` : "No switch could be timed.");
    } catch (error) {
      say(error instanceof Error ? error.message : String(error));
    }
  };
  const compare = async () => {
    try {
      const { ids } = (await rpc.call("recent_threads", { limit: 6 })) as { ids: string[] };
      if (ids.length < 2) return say("The comparison needs at least two threads.");
      const tools = { ids, rounds: 3, toThread: (id: string) => void navigate.toThread(id), back: () => void navigate.toPluginPanel("performance") };
      const on = await collector.bench(tools);
      const off = await collector.bench({ ...tools, cssOff: true });
      say(on && off ? `Thread switches: median ${on.median} ms with plugin CSS, ${off.median} ms without it.` : "No switch could be timed.");
    } catch (error) {
      collector.restoreSheets();
      say(error instanceof Error ? error.message : String(error));
    }
  };
  const probe = async () => {
    const line = await collector.probe();
    say(line ? `One style recalculation: ${line.baseMs} ms with every stylesheet, ${line.withoutMs} ms without the plugin ones.` : "Nothing to probe.");
  };
  const mark = async () => {
    const line = await collector.mark();
    say(line ? `Marked: ${line.frames} long frames in the last 15 seconds, worst ${line.worst} ms.` : "Not measuring.");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      say("Report copied. Paste it into a thread.");
    } catch {
      say("The browser would not let this page copy.");
    }
  };

  const busyText = live.busy === "bench" ? (live.cssOffNow ? "Switching threads with plugin CSS off" : "Switching threads") : live.busy === "probe" ? "Probing stylesheets" : null;
  return (
    <div className="perf-actions">
      <div className="perf-buttons">
        <button type="button" className="perf-btn" disabled={!idle} onClick={() => void bench()} title="Switches between your six most recent threads three times and times each switch. Ends back here.">Run benchmark</button>
        <button type="button" className="perf-btn" disabled={!idle} onClick={() => void compare()} title="Runs the benchmark twice, the second time with every other plugin's stylesheet switched off, to see how much of a switch is plugin CSS. Plugins look unstyled for about twenty seconds; nothing is saved.">Compare plugin CSS</button>
        <button type="button" className="perf-btn" disabled={!idle} onClick={() => void probe()} title="Switches each plugin's stylesheet off and on and times one style recalculation. The page freezes for a few seconds.">Probe CSS</button>
        <button type="button" className="perf-btn" disabled={!live.enabled} onClick={() => void mark()} title="Keeps what the last 15 seconds looked like, so a lag you just felt can be found later.">This lagged</button>
        <button type="button" className="perf-btn" disabled={!live.enabled && !held} onClick={() => collector.pause(held ? 0 : 15 * 60_000)} title="Stops measuring for 15 minutes; what is gathered stays.">{held ? "Resume" : "Pause 15 min"}</button>
        <button type="button" className="perf-btn" onClick={() => void copy()} title="A markdown summary of the worst offenders, for a thread.">Copy report</button>
      </div>
      <div className="perf-note perf-status" aria-live="polite">
        {busyText ? `${busyText}${live.progress ? ` · ${live.progress.done} of ${live.progress.total}` : ""}` : held ? `Paused until ${new Date(live.pausedUntil).toLocaleTimeString()}` : note}
      </div>
    </div>
  );
}

function Results({ live }: { live: Live }) {
  const { lastBench: bench, lastBenchOff: off, lastProbe: probe } = live;
  if (!bench && !probe) return null;
  const costs = probe ? Object.entries(probe.perPlugin).filter(([, v]) => v.ms > 0).sort((a, b) => b[1].ms - a[1].ms) : [];
  const parts = costs.slice(0, 8).map(([id, v]) => ({ id, label: v.own ? `${id} (${v.own} elements on screen)` : id, value: v.ms }));
  const rest = costs.slice(8).reduce((a, [, v]) => a + v.ms, 0);
  if (rest > 0) parts.push({ id: "others", label: "others", value: rest });
  return (
    <div className="perf-charts perf-charts-two">
      {bench && (
        <Chart title="Thread-switch benchmark" value={`median ${bench.median} ms`} tone={toneOf(bench.median, TARGETS.switchMs)} note={`95th percentile ${bench.p95} ms · ${bench.hops.length} switches over ${bench.threads} threads with ${bench.plugins} plugins · ${ago(bench.t)}.${off ? ` With plugin CSS off (${ago(off.t)}): median ${off.median} ms, 95th percentile ${off.p95} ms — ${off.median < bench.median ? `${bench.median - off.median} ms of the median is plugin CSS` : "no gain, so plugin CSS is not what slows a switch"}.` : ""} Dashed line: 100 ms.`}>
          <Bars values={bench.hops} target={TARGETS.switchMs} unit="ms" labels={bench.hops.map((_, i) => `Switch ${i + 1}`)} />
          {off && <Bars values={off.hops} target={TARGETS.switchMs} unit="ms" labels={off.hops.map((_, i) => `Switch ${i + 1}, plugin CSS off`)} />}
        </Chart>
      )}
      {probe && (
        <Chart title="Style recalculation by plugin" value={`${probe.baseMs} ms`} note={`One full recalculation over ${probe.elements} elements; ${probe.withoutMs} ms with the plugin stylesheets off. Each bar is what one recalculation gains from that plugin's stylesheet; a plugin with a screen open also has those elements restyled, which is counted in · ${ago(probe.t)}.`}>
          <Stack parts={parts} unit="ms" empty="No plugin stylesheet measurably adds to the recalculation" />
        </Chart>
      )}
    </div>
  );
}

type SortKey = "id" | "loafMs" | "cssRules" | "startMs" | "handlerCalls" | "workerRssMB" | "probeMs";

function PluginTable({ rows, probe, detail }: { rows: PluginRow[]; probe: ProbeLine | null; detail: (row: PluginRow) => ReactNode }) {
  const [sort, setSort] = useState<SortKey>("loafMs");
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const probeMs = (id: string) => probe?.perPlugin[id]?.ms ?? null;
  const sorted = useMemo(() => {
    const value = (r: PluginRow) => (sort === "id" ? r.id : sort === "probeMs" ? (probeMs(r.id) ?? -1) : ((r[sort] as number | null) ?? -1));
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return sort === "id" ? String(x).localeCompare(String(y)) : (y as number) - (x as number) || a.id.localeCompare(b.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort, probe]);
  const peak = {
    loaf: Math.max(1, ...rows.map((r) => r.loafMs)),
    css: Math.max(CSS_RULE_FLAG, ...rows.map((r) => r.cssRules ?? 0)),
    start: Math.max(START_FLAG_MS, ...rows.map((r) => r.startMs ?? 0)),
    calls: Math.max(1, ...rows.map((r) => r.handlerCalls)),
    rss: Math.max(1, ...rows.map((r) => r.workerRssMB ?? 0)),
    probe: Math.max(1, ...rows.map((r) => probeMs(r.id) ?? 0)),
  };
  const toggle = (id: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const head = (id: SortKey, label: string, num = true) => (
    <th className={num ? "perf-num" : undefined} data-active={sort === id || undefined}>
      <button type="button" className="perf-sort" onClick={() => setSort(id)}>{label}</button>
    </th>
  );
  const cell = (text: string, meter: ReactNode) => (
    <td className="perf-num perf-cell">
      <span className="perf-cell-text">{text}</span>
      {meter}
    </td>
  );
  return (
    <Grid className="perf-grid perf-plugins">
      <thead>
        <tr>
          {head("id", "Plugin", false)}
          {head("loafMs", "Slow-frame script")}
          {head("startMs", "Start")}
          {head("cssRules", "Page-wide CSS")}
          {head("probeMs", "Style recalc")}
          {head("handlerCalls", "Back-end calls")}
          {head("workerRssMB", "Host process")}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => {
          const isOpen = open.has(r.id);
          const probed = probeMs(r.id);
          return (
            <Fragment key={r.id}>
              <tr className="perf-row" data-open={isOpen || undefined}>
                <td>
                  <button type="button" className="perf-sort perf-expand" aria-expanded={isOpen} onClick={() => toggle(r.id)}>
                    <svg className="perf-chevron" viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M3 1.5 7 5 3 8.5" /></svg>
                    <i className="perf-swatch" style={{ background: `oklch(0.68 0.13 ${hueOf(r.id)})` }} />
                    {r.id}
                  </button>
                  {r.flags.map((f) => (
                    <span className="perf-flag" key={f}>{f}</span>
                  ))}
                </td>
                {cell(r.loafMs ? `${r.loafMs} ms · ${r.frames}` : "", r.loafMs ? <Meter value={r.loafMs} max={peak.loaf} tone={r.loafMs >= 100 ? "warn" : "none"} /> : null)}
                {cell(r.startMs == null ? "" : `${r.startMs} ms`, r.startMs == null ? null : <Meter value={r.startMs} max={peak.start} tone={r.startMs >= START_FLAG_MS ? "warn" : "none"} mark={START_FLAG_MS} />)}
                {cell(r.cssRules == null ? "" : `${r.cssRules} rules`, r.cssRules == null ? null : <Meter value={r.cssRules} max={peak.css} tone={r.cssRules >= CSS_RULE_FLAG ? "warn" : "none"} mark={CSS_RULE_FLAG} />)}
                {cell(probed == null ? "" : `${probed} ms`, probed ? <Meter value={probed} max={peak.probe} tone={probed >= 5 ? "warn" : "none"} /> : null)}
                {cell(`${r.handlerCalls || ""}${r.handlerErrors ? ` (${r.handlerErrors} failed)` : ""}`, r.handlerCalls ? <Meter value={r.handlerCalls} max={peak.calls} tone={r.handlerErrors ? "bad" : "none"} /> : null)}
                {cell(r.workerRssMB == null ? "" : `${Math.round(r.workerRssMB)} MB${r.workerCpuPct ? ` · ${r.workerCpuPct}%` : ""}`, r.workerRssMB == null ? null : <Meter value={r.workerRssMB} max={peak.rss} />)}
              </tr>
              {isOpen && (
                <tr className="perf-detail-row">
                  <td colSpan={7}>{detail(r)}</td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </Grid>
  );
}

interface DetailProps {
  row: PluginRow;
  merged: WindowLine;
  windows: WindowLine[];
  slows: SlowLine[];
  live: Live;
  probe: ProbeLine | null;
  words: [string, number][];
  now: number;
  rangeMs: number;
  buckets: number;
  labels: string[];
  cssKnown: boolean;
}

/** Everything known about one plugin, for the row that was opened. */
function PluginDetail({ row, merged, windows, slows, live, probe, words, now, rangeMs, buckets, labels, cssKnown }: DetailProps) {
  const id = row.id;
  const owner = merged.byPlugin[id];
  const info = live.plugins.find((p) => p.id === id);
  const bundle = live.bundles[id];
  const probed = probe?.perPlugin[id];
  // Counted once when the row opens; the plugin's own elements carry its id.
  const nodes = useMemo(() => {
    try {
      return document.querySelectorAll(`[data-bb-plugin="${CSS.escape(id)}"] *`).length;
    } catch {
      return null;
    }
  }, [id]);
  const trend = pluginSeries(windows, id, now, rangeMs, buckets);
  const kinds = CALL_KINDS.map((k) => ({ id: k.id, label: k.label, value: owner?.by?.[k.id] ?? 0 })).filter((k) => k.value > 0).sort((a, b) => b.value - a.value);
  const mine = slows.filter((l) => l.scripts.some((s) => s.owner === id)).sort((a, b) => b.ms - a.ms).slice(0, 5);
  const fact = (label: string, value: ReactNode) => (
    <div key={label}>
      <span className="perf-dim">{label}</span>
      <b>{value}</b>
    </div>
  );
  return (
    <div className="perf-detail">
      <div className="perf-detail-facts perf-facts">
        {fact("Version", info?.version ?? "unknown")}
        {fact("Script in slow frames", owner ? `${short(owner.ms)} ms in ${owner.n} frames${owner.forced ? `, ${short(owner.forced)} ms forced layout` : ""}` : "none in this period")}
        {fact("Start", row.startMs == null ? "not measured on this page load" : `${row.startMs} ms`)}
        {fact("Bundle", bundle ? `${bytes(bundle.js)} of script` : "unknown")}
        {fact("Elements it owns now", nodes == null ? "unknown" : nodes === 0 ? "none on screen" : String(nodes))}
        {fact("Page-wide CSS", row.cssRules == null ? (cssKnown ? "none" : "not counted yet") : `${row.cssRules} rules`)}
        {fact("Style recalculation", probed ? `${probed.ms} ms of one pass` : "press Probe CSS")}
        {fact("Back-end", row.handlerCalls ? `${row.handlerCalls} calls, slowest ${row.handlerMaxMs} ms${row.handlerErrors ? `, ${row.handlerErrors} failed` : ""}` : "no calls in this period")}
        {row.workerRssMB != null && fact("Host process", `${Math.round(row.workerRssMB)} MB${row.workerCpuPct ? `, ${row.workerCpuPct}% CPU` : ""}`)}
      </div>
      <div className="perf-detail-side">
        <Chart title="Script in slow frames" value={owner ? `${short(owner.ms)} ms` : undefined} from={now - rangeMs} to={now} note="Per slice of the period.">
          <Trend values={trend} unit="ms" labels={labels} empty="No script of this plugin ran in a slow frame" />
        </Chart>
        {kinds.length > 0 && (
          <div>
            <div className="perf-chart-title">What started its script</div>
            <Stack parts={kinds} unit="ms" />
          </div>
        )}
      </div>
      {words.length > 0 && (() => {
        const { words: bare, variants } = splitWords(words);
        return (
          <div className="perf-detail-wide">
            <div className="perf-chart-title">Class names behind its page-wide rules (each is a Tailwind utility word somewhere in the plugin's folder, comments included)</div>
            <div className="perf-words">
              {bare.map(([word, n]) => (
                <span className="perf-flag" key={word}>.{word} · {n}</span>
              ))}
              {variants.map(([word, n]) => (
                <span className="perf-flag" data-core key={word} title="A variant prefix the rules sit under, as in hover:zed-a">{word}* · {n}</span>
              ))}
            </div>
          </div>
        );
      })()}
      {mine.length > 0 && (
        <div className="perf-detail-wide">
          <div className="perf-chart-title">Its slowest moments</div>
          <ul className="perf-slow">
            {mine.map((l) => {
              const s = l.scripts.find((x) => x.owner === id)!;
              return (
                <li key={key(l)}>
                  <b data-tone={toneOfMs(l.ms)}>{l.ms} ms</b>
                  <span className="perf-dim">{new Date(l.t).toLocaleTimeString()} · while {l.driver}</span>
                  <span className="perf-flag">{s.ms} ms script{s.forced ? `, ${s.forced} ms forced layout` : ""}</span>
                  {l.split && <span className="perf-flag" data-core>{BOUND_LABEL[boundOf(l.split)]}</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Server({ lines, from, to }: { lines: ServerLine[]; from: number; to: number }) {
  const latest = lines[lines.length - 1];
  if (!latest) return <p className="perf-note">The first server sample arrives about a minute after the plugin loads.</p>;
  const labels = lines.map((l) => clock(l.t));
  const at = (pick: (l: ServerLine) => number) => lines.map(pick);
  const loopWorst = Math.max(...lines.map((l) => l.eventLoop.max));
  return (
    <>
      <div className="perf-charts">
        <Chart title="Event loop delay, 99th percentile" value={`${short(latest.eventLoop.p99)} ms`} tone={latest.eventLoop.p99 <= 20 ? "good" : latest.eventLoop.p99 <= 50 ? "warn" : "bad"} from={from} to={to} note={`longest stall ${short(loopWorst)} ms; sampled every 20 ms, so about 20 ms is the floor`}>
          <Trend values={at((l) => l.eventLoop.p99)} unit="ms" labels={labels} target={20} />
        </Chart>
        <Chart title="Server CPU" value={`${short(latest.cpuPct)} %`} from={from} to={to} note="all plugin back-ends together, per minute">
          <Trend values={at((l) => l.cpuPct)} unit="%" labels={labels} />
        </Chart>
        <Chart title="Server memory" value={`${Math.round(latest.rssMB)} MB`} from={from} to={to} note="resident, the whole process">
          <Trend values={at((l) => l.rssMB)} unit="MB" labels={labels} floor={Math.min(...lines.map((l) => l.rssMB)) * 0.98} />
        </Chart>
      </div>
      <p className="perf-note">
        BB runs every plugin's back-end inside this one process, so these figures are for all of them together. Back-end calls per plugin are in the plugin list above.
      </p>
    </>
  );
}

function Moments({ slows, navs, from, to }: { slows: SlowLine[]; navs: NavLine[]; from: number; to: number }) {
  const slowMarks: Mark[] = slows.map((l) => ({
    t: l.t,
    ms: l.ms,
    shape: l.what === "loaf" ? "circle" : "square",
    tone: toneOfMs(l.ms),
    title: `${l.ms} ms ${l.what === "loaf" ? "frame" : "input"} at ${new Date(l.t).toLocaleTimeString()}, while ${l.driver}${l.scripts.length ? `: ${l.scripts.map((s) => `${s.owner} ${s.ms} ms`).join(", ")}` : ""}`,
  }));
  const navMarks: Mark[] = navs.map((n) => ({
    t: n.t,
    ms: n.ms,
    shape: n.what === "panel-open" ? "square" : "circle",
    tone: n.ms <= TARGETS.switchMs ? "good" : n.ms <= TARGETS.switchMs * 2 ? "warn" : "bad",
    title: `${n.what === "thread-switch" ? "Thread switch" : n.what === "panel-open" ? "Panel open" : "Page"} ${n.ms} ms${n.settled ? "" : " or more"} at ${new Date(n.t).toLocaleTimeString()}, ${n.rows} rows${n.virtualized ? ", windowed" : ""}`,
  }));
  const top = [...slows].sort((a, b) => b.ms - a.ms).slice(0, 6);
  return (
    <>
      <div className="perf-charts">
        <Chart title="Slow frames and inputs" value={`${slows.length}`} from={from} to={to} note="Circles are frames over 100 ms, squares are inputs. Up to 1 s; the dashed line is 100 ms.">
          <Scatter marks={slowMarks} from={from} to={to} target={100} reach={1000} empty="Nothing over 100 ms in this period" />
        </Chart>
        <Chart title="Thread switches, panels and pages" value={`${navs.length}`} from={from} to={to} note="Circles are switches and pages, squares are panels opening. Up to 1 s; the dashed line is the 100 ms target.">
          <Scatter marks={navMarks} from={from} to={to} target={TARGETS.switchMs} reach={1000} empty="No switch or panel in this period" />
        </Chart>
      </div>
      {top.length > 0 && (
        <ul className="perf-slow">
          {top.map((l) => (
            <li key={key(l)}>
              <b data-tone={toneOfMs(l.ms)}>{l.ms} ms</b>
              <span className="perf-dim">{l.what === "loaf" ? "frame" : "input"} · {new Date(l.t).toLocaleTimeString()} · while {l.driver}</span>
              {l.phases && <span className="perf-flag" data-bound={phaseBound(l.phases) === "delay" ? "script" : "render"} title={`waited ${l.phases.delay} ms for the page, handlers ${l.phases.handler} ms, paint ${l.phases.present} ms`}>{{ delay: "queued behind other work", handler: "its own handlers", present: "slow to paint" }[phaseBound(l.phases)]}</span>}
              {l.split && <span className="perf-flag" data-bound={boundOf(l.split)} title={`script ${l.split.scriptMs} ms (forced layout ${l.split.forcedMs}), style and layout ${l.split.styleMs} ms, other ${l.split.otherMs} ms`}>{BOUND_LABEL[boundOf(l.split)]}</span>}
              {l.scripts.map((s) => (
                <span className="perf-flag" key={s.owner + s.inv} data-core={s.owner === CORE || undefined}>{s.owner} {s.ms} ms{s.forced ? ` (${s.forced} forced)` : ""}</span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Marks({ marks }: { marks: MarkLine[] }) {
  if (marks.length === 0) return null;
  return (
    <>
      <h2 className="perf-h">You marked these as lagging</h2>
      <ul className="perf-slow">
        {[...marks].reverse().slice(0, 8).map((m) => (
          <li key={m.t}>
            <b data-tone={toneOfMs(m.worst)}>{m.worst ? `${m.worst} ms` : "no long frame"}</b>
            <span className="perf-dim">{new Date(m.t).toLocaleTimeString()} · {m.route || "a page"} · {m.elements} elements</span>
            {m.frames > 0 && <span className="perf-flag" data-bound={boundOf(m.split)}>{BOUND_LABEL[boundOf(m.split)]}</span>}
            {Object.entries(m.owners).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([who, ms]) => (
              <span className="perf-flag" key={who} data-core={who === CORE || undefined}>{who} {Math.round(ms)} ms</span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

const DRIVERS: { id: keyof WindowLine["loaf"]["byDriver"]; label: string }[] = [
  { id: "typing", label: "Typing" },
  { id: "scroll", label: "Scrolling" },
  { id: "nav", label: "Switching" },
  { id: "idle", label: "Idle" },
  { id: "other", label: "Clicks and loading" },
];

function Panel() {
  const live = useLive();
  const { snapshot, error } = useSnapshot();
  const options = useOptions();
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("15m");
  const rangeMs = RANGES.find((r) => r.id === range)!.ms;

  const now = Date.now();
  const lines = useMemo(() => {
    const seen = new Set<string>();
    const out: Line[] = [];
    for (const l of [...(snapshot?.recent ?? []), ...live.queued, live.window]) {
      const k = key(l);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(l);
    }
    return out.sort((a, b) => a.t - b.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot, live.queued.length, live.window.loaf.n, live.window.t]);

  const { inRange, windows, merged, rows, navs, start } = compute(lines, live.heap, now, rangeMs);
  const serverLines = inRange.filter((l): l is ServerLine => l.kind === "server");
  const handlers: Record<string, { calls: number; maxMs: number; errors: number }> = {};
  for (const s of serverLines) {
    for (const [id, h] of Object.entries(s.handlers)) {
      const into = (handlers[id] ??= { calls: 0, maxMs: 0, errors: 0 });
      into.calls += h.calls;
      into.errors += h.errors;
      into.maxMs = Math.max(into.maxMs, h.maxMs);
    }
  }
  const startMs: Record<string, number> = { ...(start?.pluginMs ?? {}), ...live.startPluginMs };
  const cssLine = [...lines].reverse().find((l) => l.kind === "css");
  const css = Object.keys(live.css).length ? live.css : cssLine?.kind === "css" ? cssLine.cssRules : {};
  const pluginRowsData = pluginRows(merged, css, startMs, handlers, snapshot?.server?.workers ?? {});
  const wordsLine = [...lines].reverse().find((l) => l.kind === "css" && l.words);
  const wordsOf = (id: string): [string, number][] =>
    live.cssWords[id] ?? (wordsLine?.kind === "css" && wordsLine.words?.[id] ? Object.entries(wordsLine.words[id]).sort((a, b) => b[1] - a[1]) : []);
  const probe = live.lastProbe;
  const sites = topSites(merged.sites, 8);
  const markLines = inRange.filter((l): l is MarkLine => l.kind === "mark");
  const core = merged.byPlugin[CORE];
  // Two pages of one browser that share a process see the same slow frame; it is listed once.
  const slowLines = inRange
    .filter((l): l is SlowLine => l.kind === "slow")
    .filter((l, i, all) => all.findIndex((o) => o.what === l.what && o.ms === l.ms && Math.abs(o.t - l.t) < 50) === i);

  const buckets = range === "15m" ? 15 : 30;
  const points = series(windows, now, rangeMs, buckets);
  const labels = points.map((p) => `${clock(p.t0)}–${clock(p.t1)}`);
  const from = now - rangeMs;
  const row = (id: string) => rows.find((r) => r.id === id);
  const toneFor = (id: string) => row(id)?.tone ?? "none";
  const said = (id: string) => {
    const r = row(id);
    return r && r.value != null ? fmt(r.value, r.unit) : undefined;
  };
  const scriptShares = shares(merged.byPlugin, 8);
  const drivers = DRIVERS.map((d) => ({ id: d.id, label: d.label, value: merged.loaf.byDriver[d.id] ?? 0 }));
  const perMinute = (v: number) => (merged.visibleMs > 0 ? (v / merged.visibleMs) * 60_000 : 0);

  // Where the time of slow frames went: script (BB's own or a plugin's, less the layout it forced), forced layout, then the rest of the frame.
  const split = merged.split;
  const pluginOwners = Object.entries(merged.byPlugin).filter(([id]) => id !== CORE);
  const forcedAll = Object.values(merged.byPlugin).reduce((a, o) => a + (o.forced ?? 0), 0);
  const coreOwner = merged.byPlugin[CORE];
  const goes = split && split.frameMs > 0
    ? [
        { id: "core", label: "BB's own script", value: Math.max(0, (coreOwner?.ms ?? 0) - (coreOwner?.forced ?? 0)), color: "color-mix(in oklab, currentColor 45%, transparent)" },
        { id: "plugins", label: "Plugin script", value: Math.max(0, pluginOwners.reduce((a, [, o]) => a + o.ms - (o.forced ?? 0), 0)), color: "oklch(0.68 0.13 250)" },
        { id: "forced", label: "Layout forced by script", value: forcedAll, color: "oklch(0.66 0.17 40)" },
        { id: "style", label: "Style, layout and paint", value: split.styleMs, color: "oklch(0.68 0.13 310)" },
        { id: "other", label: "Other tasks", value: split.otherMs, color: "color-mix(in oklab, currentColor 18%, transparent)" },
      ]
    : [];
  const kinds = coreKinds(merged.byPlugin).map((k) => ({ id: k.id, label: k.label, value: k.ms }));
  const verdict = split && split.frameMs > 0 ? BOUND_LABEL[boundOf(split)] : null;

  const reportPlugins: ReportPlugin[] = pluginRowsData.map((r) => ({
    id: r.id,
    loafMs: r.loafMs,
    forcedMs: merged.byPlugin[r.id]?.forced ?? 0,
    frames: r.frames,
    startMs: r.startMs,
    cssRules: r.cssRules,
    words: wordsOf(r.id),
    probeMs: probe?.perPlugin[r.id]?.ms ?? null,
    version: live.plugins.find((p) => p.id === r.id)?.version ?? null,
  }));
  const report = () =>
    buildReport({
      at: Date.now(),
      rangeLabel: RANGES.find((r) => r.id === range)!.label,
      minutes: merged.visibleMs ? Math.round(merged.visibleMs / 60000) : 0,
      bb: live.bb,
      rows,
      merged,
      plugins: reportPlugins,
      slows: slowLines,
      marks: markLines,
      probe,
      bench: live.lastBench,
      benchOff: live.lastBenchOff,
      navs,
    });

  return (
    <div className="perf-scroll">
      <div className="perf-page">
        <Hero rows={rows} range={range} setRange={setRange} live={live} minutes={merged.visibleMs ? Math.round(merged.visibleMs / 60000) : 0} />

        {!options.enabled && (
          <p className="perf-note">
            Measuring is off. Turn on <b>Measure</b> in the <b>Performance</b> submenu of a thread's actions menu.
          </p>
        )}

        <Actions live={live} report={report} />
        <Results live={live} />

        <h2 className="perf-h">Against the targets</h2>
        <MetricCards rows={rows} />
        <p className="perf-note">
          The bar runs to three times the target, with a tick at the target. Hover a card for how it is measured.
        </p>

        <h2 className="perf-h">Over time</h2>
        <div className="perf-charts">
          <Chart title="Longest blocked frame" value={said("long")} tone={toneFor("long")} from={from} to={now} note="Worst frame in each slice. Dashed line: 50 ms.">
            <Bars values={points.map((p) => p.longest)} target={TARGETS.longFrameMs} unit="ms" labels={labels} />
          </Chart>
          <Chart title="Frame time while scrolling or typing" value={said("frame")} tone={toneFor("frame")} from={from} to={now} note="95th percentile per slice. Dashed line: 17 ms, one frame at 60 fps.">
            <Bars values={points.map((p) => p.frameP95)} target={TARGETS.frameMs} unit="ms" labels={labels} empty="Scroll or type to see this" />
          </Chart>
          <Chart title="Typing to screen" value={said("typing")} tone={toneFor("typing")} from={from} to={now} note="95th percentile per slice. Dashed line: 50 ms.">
            <Bars values={points.map((p) => p.typingP95)} target={TARGETS.inputMs} unit="ms" labels={labels} empty="Type to see this" />
          </Chart>
          <Chart title="Idle busy" value={said("idle")} tone={toneFor("idle")} from={from} to={now} note="Share of idle time spent in long frames. Dashed line: 1 %.">
            <Bars values={points.map((p) => p.idlePct)} target={TARGETS.idleBusyPct} unit="%" labels={labels} />
          </Chart>
          <Chart title="Plugin script in slow frames" value={`${Math.round(merged.byPlugin ? Object.entries(merged.byPlugin).reduce((a, [id, o]) => (id === CORE ? a : a + o.ms), 0) : 0)} ms`} from={from} to={now} note={`Plugins together, per slice${core ? `; BB's own code ran ${Math.round(core.ms)} ms` : ""}.`}>
            <Trend values={points.map((p) => (p.loafN || p.pluginMs ? p.pluginMs : null))} unit="ms" labels={labels} />
          </Chart>
          <Chart title="Page memory" value={live.heap.length ? `${Math.round(live.heap[live.heap.length - 1].mb)} MB` : undefined} tone={toneFor("heap")} from={from} to={now} note="JS heap of this page. Growth over an hour is the metric above.">
            <Trend values={points.map((p) => p.heapMB)} unit="MB" labels={labels} floor={Math.min(...points.map((p) => p.heapMB ?? Infinity)) * 0.98 || 0} />
          </Chart>
        </div>

        <h2 className="perf-h">How long things take</h2>
        <div className="perf-charts">
          <Chart title="Frames while scrolling or typing" value={`${merged.frame.hist.reduce((a, b) => a + b, 0)}`} note="How many fell in each length, in ms. Green is within 17 ms.">
            <HistChart hist={merged.frame.hist} target={TARGETS.frameMs} />
          </Chart>
          <Chart title="Key presses of 16 ms or more" value={`${merged.input.keys} keys`} note="Faster ones are not recorded. Green is within 50 ms.">
            <HistChart hist={merged.input.typing} target={TARGETS.inputMs} />
          </Chart>
          <Chart title="Clicks of 16 ms or more" value={`${merged.input.clicks} clicks`} note="Green is within 50 ms.">
            <HistChart hist={merged.input.click} target={TARGETS.inputMs} />
          </Chart>
        </div>

        <h2 className="perf-h">Slow moments</h2>
        <Moments slows={slowLines} navs={navs} from={from} to={now} />

        <Marks marks={markLines} />

        <h2 className="perf-h">Who ran in slow frames</h2>
        <div className="perf-charts perf-charts-two">
          <Chart title="Where the time of slow frames went" value={verdict ?? undefined} note={split && split.frameMs > 0 ? `${Math.round(split.frameMs)} ms in ${merged.loaf.n} frames over 50 ms. Layout forced by script is time scripts spent making the browser lay the page out early; it sits inside script time.` : "Recorded from this version on."}>
            <Stack parts={goes} unit="ms" empty="No slow frame in this period" />
          </Chart>
          <Chart title="What started BB's own script" value={kinds.length ? `${Math.round(kinds.reduce((a, k) => a + k.value, 0))} ms` : undefined} note="React's renders, including those of every plugin's components, run inside BB's code, started by message callbacks and timers.">
            <Stack parts={kinds} unit="ms" empty="No slow frame in this period" />
          </Chart>
        </div>
        {sites.length > 0 && (
          <div className="perf-charts">
            <Chart title="Where script forced layout" value={`${Math.round(sites.reduce((a, [, v]) => a + v.ms, 0))} ms`} note="The function and character position, in the shipped bundle, that read layout after the page changed. BB ships no source maps, so search the file at that position.">
              <ul className="perf-sites">
                {sites.map(([site, v]) => (
                  <li key={site}>
                    <b>{Math.round(v.ms)} ms</b>
                    <span className="perf-dim">{v.n}×</span>
                    <code>{site}</code>
                  </li>
                ))}
              </ul>
            </Chart>
          </div>
        )}
        <div className="perf-charts perf-charts-two">
          <Chart title="Script time by owner" value={`${Math.round(scriptShares.reduce((a, s) => a + s.ms, 0))} ms`} note="Inside frames over 50 ms. React renders of a plugin count as BB core.">
            <Stack parts={shareParts(scriptShares).map((p) => ({ ...p, value: p.value }))} unit="ms" empty="No slow frame in this period" />
          </Chart>
          <Chart title="What drove the slow frames" value={`${merged.loaf.n}`} note={`${short(perMinute(merged.loaf.n))} a minute on screen`}>
            <Stack parts={drivers} unit="frames" empty="No slow frame in this period" />
          </Chart>
        </div>

        <h2 className="perf-h">Plugins</h2>
        <PluginTable
          rows={pluginRowsData}
          probe={probe}
          detail={(row) => (
            <PluginDetail row={row} merged={merged} windows={windows} slows={slowLines} live={live} probe={probe} words={wordsOf(row.id)} now={now} rangeMs={rangeMs} buckets={buckets} labels={labels} cssKnown={Object.keys(css).length > 0} />
          )}
        />
        <p className="perf-note">
          Open a row for the rest. Slow-frame script is the time a plugin's own code ran inside frames over 50 ms. A plugin's React components render inside BB's code, so their cost shows under BB core: a slow-typing result with no plugin to blame is a suspect, not a verdict.
          Page-wide CSS counts rules BB checks against every element; the tick is {CSS_RULE_FLAG}. Start has its tick at {START_FLAG_MS} ms.
        </p>

        <h2 className="perf-h">Server</h2>
        <Server lines={serverLines} from={from} to={now} />

        <h2 className="perf-h">This plugin</h2>
        <div className="perf-facts">
          <div><span className="perf-dim">Its own callbacks, this period</span><b>{Math.round(merged.selfMs)} ms</b></div>
          <div><span className="perf-dim">Metrics files</span><b>{snapshot ? `${snapshot.files} day${snapshot.files === 1 ? "" : "s"}` : "…"}</b></div>
          <p className="perf-note perf-path">{snapshot?.dir ?? ""}</p>
          {snapshot?.lastWriteError && <p className="perf-note" data-tone="bad">Could not write: {snapshot.lastWriteError}</p>}
          {(error || live.lastError) && <p className="perf-note" data-tone="warn">{error ?? live.lastError}</p>}
        </div>
      </div>
    </div>
  );
}

export default Panel;

/** Header actions: send what is gathered now instead of waiting for the minute. */
export function HeaderActions() {
  return (
    <button type="button" className="perf-sort perf-head-button" onClick={() => void collector.flushNow()} title="Send what is gathered so far to the server">
      <Icon name="ArrowReloadHorizontal" />
      Flush now
    </button>
  );
}
