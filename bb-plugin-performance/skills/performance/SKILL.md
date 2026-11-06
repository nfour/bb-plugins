---
name: performance
description: Explain, configure or read the Performance plugin, which measures how far BB is from feeling native (frames, typing, thread switches, start, idle, memory) in real sessions and shows which plugin is behind a slowdown. Use when the user asks why BB feels slow, which plugin is slow, what the Performance tab or its nav badge means, or where the metrics file is.
---

# Performance

The plugin measures in the page while the user works and shows the result in the **Performance** tab of BB's nav. It never changes anything: it does not disable plugins or touch settings. It writes its numbers to `~/.bb/plugins/performance/metrics/YYYY-MM-DD.jsonl`.

## Reading the numbers

Targets: a frame 17 ms with nothing blocking over 50 ms; typing and clicks under 50 ms; a thread switch or a panel opening under 100 ms; cold start under 1 s; idle busy under 1 % and memory steady (under 5 MB/h).

- `bb performance summary [--json]` prints each metric from the file, with its tone against the target. `bb performance files` prints the folder.
- Lines in a day file have `kind`: `window` (histograms per minute, with `split`: how long frames divide into script, forced layout, style and layout, other; and `sites`: the biggest places that forced layout), `slow` (a frame or input over 100 ms, with the plugins whose scripts ran in it, the layout they forced, its `split`, and for an input `phases`: wait, handlers, paint), `nav` (thread switch, page, panel open), `start`, `css` (page-wide rules per plugin and the class `words` behind them), `mark` (the user pressed "This lagged"), `bench` (a thread-switch benchmark; `cssOff` true when plugin stylesheets were off), `probe` (what each plugin's stylesheet adds to one style recalculation), `server` (event loop, CPU, memory, plugin worker processes, back-end calls per plugin). The first line is `targets`.
- A slow frame is script-bound when script is its largest part, render-bound when style and layout after the scripts is. Layout forced by script sits inside script time. BB core's script is mostly React, started by message callbacks (the scheduler) and timers.
- Slow-frame script time is exact per plugin. A plugin's React renders count as BB core, so a slow keystroke with no plugin named is a suspect, not a verdict.
- Page-wide CSS rules: more than 300 for one plugin is flagged. They come from utility words in a plugin's folder (see the repo's `AGENTS.md`).
- Plugin back-ends run inside BB's server process (the plugin log says `pid`), so back-end CPU is not split per plugin; only plugins with a `bb.host` worker have their own memory and CPU.
- A headless browser draws on the CPU and reads slow. Trust numbers from real sessions.

## Actions in the tab

**Compare plugin CSS** (the benchmark twice, the second without plugin stylesheets), **Run benchmark** (six recent threads, three rounds, first switch dropped), **Probe CSS** (freezes the page for a few seconds), **This lagged**, **Pause 15 min** and **Copy report**. When asked why BB lags, read the file or `Copy report` text first: the `split` and `mark` lines say whether the cost is script or rendering, and `css` `words` name the class words to remove from a plugin's folder.

## Options

**Performance** in a thread's actions menu, or `bb plugin config performance`. All booleans, default on:

| Key | Effect |
| --- | --- |
| `enabled` | Measure at all. Off attaches nothing to the page. |
| `writeFile` | Append to the metrics file. |
| `sampleServer` | The once-a-minute server and worker sample. |

To compare with a plugin off, `bb plugin disable <id>` or `bb plugin safe-mode on`, only with the user's go-ahead: they change the user's setup.
