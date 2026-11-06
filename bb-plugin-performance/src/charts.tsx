// bb-plugin-performance — small SVG charts, no library. Shapes stretch to the
// width they are given; every line uses a non-scaling stroke so it stays thin.
// Colours come from the `perf-tone-*` classes in styles.css (light and dark).
import type { CSSProperties, ReactNode } from "react";
import { CORE, EDGES, toneOf, type Hist, type Share, type Tone } from "./model";

const W = 300;
const H = 64;

const pad = (n: number) => String(n).padStart(2, "0");
export const clock = (t: number) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`;

/** A number with the digits that matter: 3 significant figures at most. */
export function short(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value));
  return String(Math.round(value * 10) / 10);
}

/** Space above the bars for the target line: charts reach to this many times the target, and bars past it are cut. */
const REACH = 4;

interface ChartProps {
  title: string;
  /** The headline number beside the title. */
  value?: ReactNode;
  tone?: Tone;
  note?: ReactNode;
  children: ReactNode;
  from?: number;
  to?: number;
}

/** A titled chart with its time axis. */
export function Chart({ title, value, tone = "none", note, children, from, to }: ChartProps) {
  return (
    <figure className="perf-chart">
      <figcaption>
        <span className="perf-chart-title">{title}</span>
        {value != null && (
          <b className="perf-chart-value" data-tone={tone}>
            {value}
          </b>
        )}
      </figcaption>
      {children}
      {from != null && to != null ? (
        <div className="perf-axis">
          <span>{clock(from)}</span>
          <span>{clock(to)}</span>
        </div>
      ) : null}
      {note ? <div className="perf-chart-note">{note}</div> : null}
    </figure>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="perf-empty">{text}</div>;
}

/** One bar per bucket, tinted by how it stands against `target`; a dashed line marks the target. */
export function Bars({ values, target, unit, labels, empty = "No data in this period" }: { values: (number | null)[]; target: number; unit: string; labels: string[]; empty?: string }) {
  if (!values.some((v) => v != null)) return <Empty text={empty} />;
  const top = target * REACH;
  const peak = Math.max(top / 2, ...values.map((v) => v ?? 0));
  const max = Math.min(top, peak * 1.1);
  const step = W / values.length;
  const y = (v: number) => H - Math.max(1.5, (Math.min(v, max) / max) * H);
  return (
    <svg className="perf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Bars against a target of ${target} ${unit}`}>
      {target <= max && <line className="perf-target" x1="0" x2={W} y1={y(target)} y2={y(target)} />}
      {values.map((v, i) =>
        v == null ? null : (
          <rect key={i} className="perf-tone" data-tone={toneOf(v, target)} x={i * step + step * 0.12} width={step * 0.76} y={y(v)} height={H - y(v)} rx="1.5">
            <title>{`${labels[i]}: ${short(v)} ${unit}`}</title>
          </rect>
        ),
      )}
    </svg>
  );
}

/** A line over time with an area under it, gaps left open; `target` draws a dashed line when given. */
export function Trend({ values, target, unit, labels, floor = 0, empty = "No data in this period" }: { values: (number | null)[]; target?: number; unit: string; labels: string[]; floor?: number; empty?: string }) {
  const have = values.filter((v): v is number => v != null);
  if (have.length === 0) return <Empty text={empty} />;
  const lo = Math.min(floor, ...have);
  const hi = Math.max(target != null ? target * 1.5 : 0, ...have, lo + 1);
  const span = hi - lo;
  const step = values.length > 1 ? W / (values.length - 1) : W;
  const x = (i: number) => (values.length > 1 ? i * step : W / 2);
  const y = (v: number) => H - 3 - ((v - lo) / span) * (H - 8);
  // Runs of consecutive points, so a gap is a gap rather than a line down to zero.
  const runs: { i: number; v: number }[][] = [];
  values.forEach((v, i) => {
    if (v == null) return;
    const last = runs[runs.length - 1];
    if (last && last[last.length - 1].i === i - 1) last.push({ i, v });
    else runs.push([{ i, v }]);
  });
  return (
    <div className="perf-plot">
      <svg className="perf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`Line in ${unit}`}>
        {target != null && target <= hi && <line className="perf-target" x1="0" x2={W} y1={y(target)} y2={y(target)} />}
        {runs.map((run, r) => {
          const path = run.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
          return (
            <g key={r}>
              {run.length > 1 && <path className="perf-area" d={`${path} L${x(run[run.length - 1].i).toFixed(1)} ${H} L${x(run[0].i).toFixed(1)} ${H} Z`} />}
              <path className="perf-line" d={path} />
            </g>
          );
        })}
      </svg>
      {values.map((v, i) =>
        v == null ? null : <span key={i} className="perf-pt" data-shape="small" style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(v) / H) * 100}%` }} title={`${labels[i]}: ${short(v)} ${unit}`} />,
      )}
    </div>
  );
}

const edgeLabel = (i: number) => { const e = i < EDGES.length ? EDGES[i] : EDGES[EDGES.length - 1]; return `${e >= 1000 ? `${e / 1000}k` : e}${i < EDGES.length ? "" : "+"}`; };

/** The distribution of a histogram: one bar per bucket, bars past `target` tinted. */
export function HistChart({ hist, target, unit = "ms" }: { hist: Hist; target: number; unit?: string }) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return <Empty text="No samples yet" />;
  const peak = Math.max(...hist);
  const names = hist.map((_, i) => (i === 0 ? `up to ${EDGES[0]}` : i < EDGES.length ? `${EDGES[i - 1]}–${EDGES[i]}` : `over ${EDGES[EDGES.length - 1]}`));
  return (
    <div className="perf-hist">
      <svg className="perf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Distribution">
        {hist.map((n, i) => {
          const step = W / hist.length;
          const h = n === 0 ? 0 : Math.max(2, (n / peak) * (H - 4));
          // A bucket is within target when its upper edge is.
          const edge = i < EDGES.length ? EDGES[i] : Infinity;
          const tone: Tone = edge <= target ? "good" : edge <= target * 2 ? "warn" : "bad";
          return (
            <rect key={i} className="perf-tone" data-tone={tone} x={i * step + step * 0.1} width={step * 0.8} y={H - h} height={h} rx="1.5">
              <title>{`${names[i]} ${unit}: ${n} (${Math.round((n / total) * 100)}%)`}</title>
            </rect>
          );
        })}
      </svg>
      <div className="perf-hist-edges">
        {hist.map((_, i) => (
          <span key={i}>{edgeLabel(i)}</span>
        ))}
      </div>
    </div>
  );
}

/** A deterministic hue per plugin, so a plugin keeps its colour from chart to chart. */
export function hueOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

const swatch = (id: string): CSSProperties =>
  id === CORE ? { background: "color-mix(in oklab, currentColor 45%, transparent)" } : id === "others" ? { background: "color-mix(in oklab, currentColor 22%, transparent)" } : { background: `oklch(0.68 0.13 ${hueOf(id)})` };

/** One horizontal bar split into parts, with a legend; used for who ran in slow frames and what drove them. */
export function Stack({ parts, unit, empty = "Nothing in this period" }: { parts: { id: string; label?: string; value: number; color?: string }[]; unit: string; empty?: string }) {
  const paint = (p: { id: string; color?: string }): CSSProperties => (p.color ? { background: p.color } : swatch(p.id));
  const total = parts.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return <Empty text={empty} />;
  return (
    <div className="perf-stack">
      <div className="perf-stack-bar" role="img" aria-label={`Split of ${short(total)} ${unit}`} style={{ gridTemplateColumns: parts.map((p) => `${Math.max(0.0001, p.value)}fr`).join(" ") }}>
        {parts.map((p) => (
          <span key={p.id} style={paint(p)} title={`${p.label ?? p.id}: ${short(p.value)} ${unit} (${Math.round((p.value / total) * 100)}%)`} />
        ))}
      </div>
      <ul className="perf-legend">
        {parts.map((p) => (
          <li key={p.id}>
            <i style={paint(p)} />
            <span>{p.label ?? p.id}</span>
            <b>{short(p.value)} {unit}</b>
            <span className="perf-dim">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const shareParts = (shares: Share[]) => shares.map((s) => ({ id: s.id, value: s.ms }));

export interface Mark {
  t: number;
  ms: number;
  shape: "circle" | "square";
  tone: Tone;
  title: string;
}

/** Events on a time axis: x is when, y is how long (cut at `reach`), shape says what kind. Points are plain boxes so they stay round. */
export function Scatter({ marks, from, to, target, reach, empty }: { marks: Mark[]; from: number; to: number; target: number; reach: number; empty: string }) {
  if (marks.length === 0) return <Empty text={empty} />;
  const span = to - from;
  const left = (t: number) => 2 + ((t - from) / span) * 96;
  const top = (ms: number) => 100 - (6 + (Math.min(ms, reach) / reach) * 88);
  return (
    <div className="perf-plot perf-scatter">
      <svg className="perf-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Events over time">
        <line className="perf-target" x1="0" x2={W} y1={(top(target) / 100) * H} y2={(top(target) / 100) * H} />
      </svg>
      {marks.map((m, i) => (
        <span key={i} className="perf-pt perf-tone" data-tone={m.tone} data-shape={m.shape} style={{ left: `${left(m.t)}%`, top: `${top(m.ms)}%` }} title={m.title} />
      ))}
    </div>
  );
}

/** A meter: how far a value is along a scale of `target × 3`, with a tick at the target. */
export function Gauge({ value, target, tone }: { value: number | null; target: number; tone: Tone }) {
  const scale = target * 3;
  const pct = value == null ? 0 : Math.max(value > 0 ? 1.5 : 0, Math.min(100, (Math.max(0, value) / scale) * 100));
  return (
    <div className="perf-gauge" aria-hidden="true">
      <span className="perf-tone" data-tone={tone} style={{ width: `${pct}%` }} />
      <u style={{ left: `${100 / 3}%` }} />
    </div>
  );
}

/** A bar inside a list cell, `value` against `max`, optionally tinted. */
export function Meter({ value, max, tone = "none", mark }: { value: number; max: number; tone?: Tone; mark?: number }) {
  return (
    <span className="perf-meter" aria-hidden="true">
      <span className="perf-tone" data-tone={tone} style={{ width: `${Math.min(100, max > 0 ? (value / max) * 100 : 0)}%` }} />
      {mark != null && max > 0 && mark <= max ? <u style={{ left: `${(mark / max) * 100}%` }} /> : null}
    </span>
  );
}
