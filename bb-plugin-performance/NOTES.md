# Performance: design notes

How the plugin works and what to keep true when changing it. The README says what it does for a user.

## Shape

- A nav-panel tab (`app.slots.navPanel`, route `/plugins/performance/performance`). It measures in the user's real sessions and says which plugin is behind a slowdown. Nothing attaches while the `enabled` setting is off.
- Page side: `src/collector.ts`, a content-script singleton (`collector.mount(signal)`, configured by the null overlay `src/Loader.tsx`, which keeps the RPC in a ref so the effect reruns only on a real setting change). Dashboard: `src/Panel.tsx` with plain-SVG charts in `src/charts.tsx` (no library). Pure core: `src/model.ts` (targets, histograms, `measures`, `pluginRows`, `ownerOf`, `driverAt`, `heapSlope`, `splitOf`, `settleAfter`, `series`, `shares`), tested with `src/jsonl.ts`, `src/proc.ts` and `src/report.ts`.
- Server: `server.ts` appends lines to `~/.bb/plugins/performance/metrics/YYYY-MM-DD.jsonl` (14 days, 5 MB per file; no ids, titles or text are written; routes have ids stripped), keeps the last 400 lines for the `snapshot` RPC, serves `recent_threads` (ids only, for the benchmark), and samples the server once a minute: event loop delay, CPU, RSS, `bb.host` workers from `/proc`, and per-plugin handler call deltas from the page-reported `handlerStats`. `bb performance summary|files` reads it.
- File size (`forFile` in `server.ts`, `slimServer`/`cssKey` in `src/model.ts`): the recent-lines list and the dashboard keep every line whole; only the file is trimmed. A `css` line is written once per distinct content (`cssKey`) per day, because every page load reports the same rules. A `server` line takes RSS to to whole MB and CPU to 0.1, drops `handlers` entries' zero `errors` and an empty `handlers`, and writes `workers` only as a delta against the last written line (`delta: true`, `gone`: workers that ended); the first line of a day and every 30th (`WORKER_KEY_EVERY`) carry all workers, so a reader can start anywhere in a file. Measured on the 12 day files of 2026-11-02..13 (replaying them): `server` + `css` 10.3 MB to 6.5 MB (-37%); a day of 2.3 MB became 1.7 MB.
- Options (`enabled`, `writeFile`, `sampleServer`) are a `choices` submenu of a thread action (`src/ThreadMenu.ts`), written through `set_setting`.

## What is measured, and how

- `long-animation-frame` entries: each script is attributed to a plugin by `sourceURL`, matched against each plugin's bundle URL from `GET /api/v1/plugins` (a hash-only match gives `plugin:<hash>`); anything else is `BB core`. React renders of a plugin's components run inside BB's bundle, so they count as BB core.
- Each entry is split by `splitOf` into script, forced layout (inside script), style and layout (from `styleAndLayoutStart`) and other; per owner `forced` and `by` call kind (`kindOf` of `invokerType`/`invoker`); forced layout per call site in `window.sites` (`owner · file (BB core only) function@position`, top 12 per window). In BB's bundle the top sites are React's scheduler (`E` in boot-vendor) and its discrete-event dispatch, so the cost is render and layout effects, not one function.
- `event` entries (typing, clicks): a slow input's `phases` (`phasesOf`: wait, handlers, paint) and the owners of overlapping frames are written 300 ms after it, once the frames have been reported.
- A rAF frame sampler runs only within 400 ms of a key, wheel, scroll or pointerdown. Thread switches and page changes: the Navigation API `navigate` event plus a MutationObserver that settles after 100 ms of quiet (capped at 2 s, then the value is a floor, `settled: false`). Panel opens: an attribute observer on `data-panel-size`. Heap: a 30 s timer.
- Cold start: first paint, then the first 500 ms without a long frame (`settleAfter`), read once 10 s after a fresh load; `capped` when still busy then. Lines without `quietMs` are from the old meaning (end of the last long frame) and are ignored by the dashboard. Frames in the first 10 s of a load are start-up, never idle.
- Page-wide CSS: for each plugin sheet in `document.styleSheets` (mapped by the hash in its URL), the rules `:where([data-bb-plugin…]) .word`; `classOfSelector`/`classParts` undo the escapes and split bare word from variant (variants stored as `name:`).
- Windows are histograms (`EDGES` in `src/model.ts`), flushed once a minute, on `pagehide` and when the tab goes to the background, through the `ingest` RPC, one flush at a time. A percentile in the last bucket is a floor (`capped`).
- Entries before `loafSeen`/`eventSeen` are skipped: an observer attached again replays the browser's buffer.
- Plugin bundle sizes come from the plugin list's `jsBytes` (the resource timing buffer fills at 250 entries). Slow frames that two pages sharing a process both report (same ms, within 50 ms) are listed once.

## Automated pages

A page with `navigator.webdriver === true` (headless Chrome, scripted browsers) measures for its own dashboard but `send()` returns before `ingest`: nothing is written. A headless page draws on the CPU, so its frame and start numbers are far worse than a real screen's and would pass for the user's. The dashboard shows a note (`Live.automated`). Verify by starting a headless session and checking that the day's file gains no lines from it.

## Actions (in the collector)

- `probe()`: per plugin sheet, `sheet.disabled` toggled and one `getComputedStyle(document.body).color` read (recalculates style, does not lay out); one plugin per task, median of three; its own frames are ignored through `ignore` ranges that open at the start. A probe time includes restyling the plugin's own elements on screen, so the element count is shown beside it.
- `bench()`: thread switches through `useBbNavigate().toThread`, resolved by the `nav` listener, first hop dropped, 5 s cap, returns to the tab. With `cssOff` every plugin sheet but this plugin's own is switched off (`offSheets`, always restored in `finally` and on detach) for **Compare plugin CSS**, kept as `benchOff`.
- `mark()` (from `recentFrames`, last 15 s), `pause()`. Results persist in `localStorage["performance:last"]`.

## Standing timers

Every page timer pauses while the tab is in the background and catches up once on `visibilitychange`: the 30 s tick (heap, plugin list, flush) returns early; the 1 s dashboard emit skips; the rAF sampler stops; on return `refreshPlugins().then(emit)` runs once. The settle poll (50 ms) exists only during a navigation. The server's once-a-minute sampler cannot know about tab visibility; it costs about 3 ms (a `/proc` scan of ~80 pids) and is turned off by the `sampleServer` setting.

## Gotchas

- `bb plugin build` scopes every utility word found anywhere in the folder (code, comments, tests, docs, this file) as a page-wide rule. Check `dist/app.css` for `:where([data-bb-plugin=` after every build; it must be 0. Avoided or split: the element name for a data sheet (`("tab" + "le") as unknown as ElementType` in `src/Panel.tsx`), the tab's background-state property (`isAway()` in `src/page.ts`), and any layout, display or sizing word that is also a Tailwind class, in code, comments, tests and docs alike. Tests use `zed` for a stand-in word.
- Use BB's own icon names (`TimeSchedule`, `ArrowReloadHorizontal`); an unknown name renders the fallback bolt.
- BB gives a nav panel no scroller: `.perf-scroll` (`height: 100%`, `overflow-y: auto`) is its own. Headless wheel events do not scroll; use PageDown.
- Charts: bars, trends and the plot area stretch with `preserveAspectRatio="none"` and non-scaling strokes, but a dot is an HTML box over the SVG (`.perf-pt`), because stretched circles turn oval.
- Plugin back-ends run inside BB's server process (the plugin's log `pid` equals the server's), so only `bb.host` workers have their own CPU and memory. `handlerStats.maxMs` is lifetime wall time including awaits, so it says nothing about a moment: it is neither sent nor written.
- Headless runs: a script has about 60 s per run (split long steps); at most 4 JPEG screenshots a run, and a PNG request stops the session. Use `p.shot({type: "jpeg"})`.
- The accordion rows are `PluginDetail` in `src/Panel.tsx`; `src/report.ts` builds the Copy report from what the dashboard shows.
