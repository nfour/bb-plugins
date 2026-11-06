// bb-plugin-performance — the report you can paste into a thread, as markdown.
//
// Pure: the dashboard hands it the figures it already shows, so the report and
// the screen never disagree. Nothing in it names a thread or holds content;
// routes have their ids dropped at the source.
import { boundOf, CORE, coreKinds, median as medianOf, phaseBound, splitWords, topSites, type BenchLine, type MarkLine, type Measure, type NavLine, type ProbeLine, type SlowLine, type WindowLine } from "./model.ts";

export interface ReportPlugin {
  id: string;
  loafMs: number;
  forcedMs: number;
  frames: number;
  startMs: number | null;
  cssRules: number | null;
  words: [string, number][];
  probeMs: number | null;
  version: string | null;
}

export interface ReportInput {
  at: number;
  rangeLabel: string;
  minutes: number;
  bb: string | null;
  rows: Measure[];
  merged: WindowLine;
  plugins: ReportPlugin[];
  slows: SlowLine[];
  marks: MarkLine[];
  probe: ProbeLine | null;
  bench: BenchLine | null;
  /** The benchmark with the plugin stylesheets switched off. */
  benchOff?: BenchLine | null;
  /** The thread switches, panel opens and page changes of the period. */
  navs?: NavLine[];
}

const num = (x: number) => (Math.abs(x) >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
const median = (xs: number[]) => medianOf(xs) ?? 0;
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%");

/** The words a plugin's page-wide rules come from, then the variants (`hover`, `max-md`) that most of them sit under. */
function wordsNote(entries: [string, number][]): string {
  const { words, variants } = splitWords(entries);
  const bits = [
    words.length ? `words: ${words.slice(0, 4).map(([w, n]) => `${w}×${n}`).join(", ")}` : "",
    variants.length ? `variants: ${variants.slice(0, 3).map(([w, n]) => `${w.slice(0, -1)}×${n}`).join(", ")}` : "",
  ].filter(Boolean);
  return bits.length ? ` (${bits.join("; ")})` : "";
}

export function buildReport(input: ReportInput): string {
  const { rows, merged, plugins, slows, marks, probe, bench } = input;
  const navs = input.navs ?? [];
  const out: string[] = [];
  out.push(`# BB performance report`);
  out.push(`${new Date(input.at).toISOString()} · last ${input.rangeLabel}, ${input.minutes} min on screen${input.bb ? ` · BB ${input.bb}` : ""} · ${plugins.length} plugins`);

  out.push("", "## Against the targets");
  for (const r of rows) {
    const state = r.value == null ? "no data" : r.tone === "good" ? "within" : `over by ${num(r.gap ?? 0)} ${r.unit}`;
    out.push(`- ${r.label}: ${r.value == null ? "no data" : `${r.capped ? "at least " : ""}${num(r.value)} ${r.unit}`}${r.capped ? " (the slowest bucket, so the true value is higher)" : ""} (target ${r.target} ${r.unit}, ${state})`);
  }

  const split = merged.split;
  out.push("", "## Slow frames");
  if (!split || split.frameMs <= 0) {
    out.push("No frame over 50 ms in this period.");
  } else {
    const bound = boundOf(split);
    out.push(
      `${merged.loaf.n} frames over 50 ms, ${num(split.frameMs)} ms in all, mostly ${bound}-bound.`,
      `- Script ${num(split.scriptMs)} ms (${pct(split.scriptMs, split.frameMs)}), of which forced layout ${num(split.forcedMs)} ms`,
      `- Style, layout and paint after the scripts ${num(split.styleMs)} ms (${pct(split.styleMs, split.frameMs)})`,
      `- Other tasks ${num(split.otherMs)} ms (${pct(split.otherMs, split.frameMs)})`,
    );
    const core = merged.byPlugin[CORE];
    if (core) out.push(`- BB core ran ${num(core.ms)} ms of that script${core.forced ? ` (forced layout ${num(core.forced)} ms)` : ""}; a plugin's React renders count here`);
    const kinds = coreKinds(merged.byPlugin);
    if (kinds.length) out.push(`- BB core started by: ${kinds.map((k) => `${k.label} ${num(k.ms)} ms`).join(", ")}`);
    const sites = topSites(merged.sites, 6);
    if (sites.length) {
      out.push("", "### Where layout was forced", "Function and character position in the bundle that read layout after a change (BB ships no source maps, so the position is searchable in the shipped file):");
      for (const [site, v] of sites) out.push(`- ${site}: ${num(v.ms)} ms in ${v.n} call${v.n === 1 ? "" : "s"}`);
    }
  }

  const switches = navs.filter((n) => n.what === "thread-switch");
  if (switches.length) {
    out.push("", "## Thread switches");
    const ms = switches.map((n) => n.ms);
    const slowOnes = switches.filter((n) => n.ms >= 100);
    out.push(`${switches.length} switches, median ${num(median(ms))} ms, ${slowOnes.length} over 100 ms${switches.some((n) => !n.settled) ? "; some were still changing at the 2 s cap, so those are floors" : ""}.`);
    const rowsOf = (list: NavLine[]) => (list.length ? num(median(list.map((n) => n.rows))) : "n/a");
    const fast = switches.filter((n) => n.ms < 100);
    out.push(`- Rows on screen (median): ${rowsOf(slowOnes)} in the slow ones, ${rowsOf(fast)} in the fast ones`);
    const windowed = switches.filter((n) => n.virtualized);
    out.push(`- Timeline windowed: ${windowed.length} of ${switches.length}${windowed.length && windowed.length < switches.length ? `; median ${num(median(windowed.map((n) => n.ms)))} ms windowed against ${num(median(switches.filter((n) => !n.virtualized).map((n) => n.ms)))} ms not` : ""}`);
    const forced = switches.reduce((a, n) => a + (n.split?.forcedMs ?? 0), 0);
    const frame = switches.reduce((a, n) => a + (n.split?.frameMs ?? 0), 0);
    if (frame > 0) out.push(`- Long frames inside them: ${num(frame)} ms, of which forced layout ${num(forced)} ms (${pct(forced, frame)})`);
  }

  out.push("", "## Plugins, worst first");
  const pluginScript = plugins.reduce((a, p) => a + p.loafMs, 0);
  const coreScript = merged.byPlugin[CORE]?.ms ?? 0;
  out.push(`Script in slow frames: plugins ${num(pluginScript)} ms, BB core ${num(coreScript)} ms. ${pluginScript === 0 ? "No plugin bundle ran in a slow frame, so what is listed is page-wide CSS and start-up." : ""}`.trim());
  const ranked = [...plugins]
    .sort((a, b) => b.loafMs + (b.probeMs ?? 0) - (a.loafMs + (a.probeMs ?? 0)) || (b.cssRules ?? 0) - (a.cssRules ?? 0) || a.id.localeCompare(b.id))
    .slice(0, 12);
  for (const p of ranked) {
    const bits = [
      p.loafMs ? `script in slow frames ${num(p.loafMs)} ms${p.forcedMs ? ` (forced layout ${num(p.forcedMs)} ms)` : ""} in ${p.frames} frames` : null,
      p.startMs != null ? `start ${num(p.startMs)} ms` : null,
      p.cssRules ? `${p.cssRules} page-wide CSS rules${wordsNote(p.words)}` : null,
      p.probeMs != null && p.probeMs > 0 ? `style recalculation ${num(p.probeMs)} ms` : null,
    ].filter(Boolean);
    if (bits.length) out.push(`- ${p.id}${p.version ? ` ${p.version}` : ""}: ${bits.join("; ")}`);
  }

  const top = [...slows].sort((a, b) => b.ms - a.ms).slice(0, 5);
  if (top.length) {
    out.push("", "## Slowest moments");
    for (const l of top) {
      const owners = l.scripts.map((s) => `${s.owner} ${s.ms} ms${s.forced ? ` (forced ${s.forced})` : ""}`).join(", ");
      const phases = l.phases ? `, waited ${l.phases.delay} ms, handlers ${l.phases.handler} ms, paint ${l.phases.present} ms (${{ delay: "queued behind other work", handler: "its own handlers", present: "rendering after the handlers" }[phaseBound(l.phases)]})` : "";
      out.push(`- ${l.ms} ms ${l.what === "loaf" ? "frame" : "input"} while ${l.driver}${l.split ? `, ${boundOf(l.split)}-bound` : ""}${phases}${owners ? `${l.what === "input" ? "; frames meanwhile" : ""}: ${owners}` : ""}`);
    }
  }

  if (marks.length) {
    out.push("", "## Marked as lagging");
    for (const m of marks.slice(-5)) {
      out.push(`- ${new Date(m.t).toLocaleTimeString()} on ${m.route || "a page"}: ${m.frames} long frames, worst ${m.worst} ms, ${m.elements} elements${Object.keys(m.owners).length ? `, ${Object.entries(m.owners).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${num(v)} ms`).join(", ")}` : ""}`);
    }
  }

  if (bench) out.push("", "## Last thread-switch benchmark", `${bench.hops.length} switches across ${bench.threads} threads with ${bench.plugins} plugins: median ${bench.median} ms, 95th percentile ${bench.p95} ms (target 100 ms).`);
  if (input.benchOff && bench) {
    const off = input.benchOff;
    out.push("", "## Plugin CSS against a thread switch", `With every other plugin's stylesheet switched off: median ${off.median} ms, 95th percentile ${off.p95} ms; with them on: median ${bench.median} ms, 95th percentile ${bench.p95} ms. ${off.median < bench.median ? `Plugin CSS accounts for about ${bench.median - off.median} ms of the median switch.` : "Switching them off did not make a switch faster, so plugin CSS is not what slows it."}`);
  }
  if (probe) {
    const worst = Object.entries(probe.perPlugin).sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).filter(([, v]) => v.ms > 0);
    out.push("", "## Last style probe", `One recalculation over ${probe.elements} elements: ${probe.baseMs} ms with every stylesheet, ${probe.withoutMs} ms with the plugin ones off.${worst.length ? ` Costliest: ${worst.map(([id, v]) => `${id} ${v.ms} ms`).join(", ")}.` : ""}`);
  }
  return out.join("\n");
}
