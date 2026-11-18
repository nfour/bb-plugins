# Changelog

Releases are the tags `performance/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## Unreleased

- A **Performance** tab in BB's nav: a score and nine metrics against targets (frame time, blocked frames, typing and click latency, thread switch, panel open, cold start, idle busy time, memory growth), charts over the last 15 minutes or hour, distributions of frame and input lengths, slow moments as dots on a time axis, bars for who ran in slow frames and what drove them, a per-plugin list with bars (script time in slow frames, start time, page-wide style rules, server calls, worker memory) and the server process as lines.
- Writes the metrics to a JSONL file a day, `bb performance summary` reads it back.
- Slow frames are split into script, layout the script forced, style and layout, and other tasks, with a verdict on each slow moment (script-bound, render-bound or other tasks) and a chart of where the time went, including what started BB's own script.
- Each plugin row opens to show its trend, what started its script, bundle size, the elements it owns, and the class names behind its page-wide CSS rules.
- Actions: **Run benchmark** (times thread switches the same way each run), **Probe CSS** (times what each plugin's stylesheet adds to a style recalculation), **This lagged** (marks a moment; also in the thread menu), **Pause 15 min** and **Copy report** (a markdown summary for a thread).
- Slow inputs say how they divided (waiting for the page, handlers, paint) and which owners ran meanwhile; the places in a bundle that forced layout are listed with file, function and position; a value in the slowest histogram bucket is shown as "at least"; the report adds thread switches (rows, windowed or not, forced layout), plugin script against BB core, and the BB version.
- **Compare plugin CSS** runs the thread-switch benchmark with and without the other plugins' stylesheets.
- Class names behind a plugin's page-wide rules are read back from the stylesheet (escapes undone) and shown as bare words and variants.
- Pages driven by automation (headless or scripted browsers, `navigator.webdriver`) are measured for their own dashboard but write nothing to the metrics files, so bots and tests no longer pass for your real use.
- Cold start is now first paint plus the first 500 ms without a long frame (it used to be the end of the last long frame in the first 10 s, which was always near the 10 s cap).
- A badge on the nav icon with the biggest gap as a multiple of its target.
- The Copy report says whether BB's "Faster styles inside plugins" experiment (`keyedPluginCss`) is on. A BB update in the middle of a day is now marked in the day's file, and the share of slow-frame time spent in style and layout is no longer inflated by a few frames that reported no style work.
- The metrics files are about a third smaller (a day of 2.3 MB becomes 1.7 MB): the page-wide CSS line is written once a day instead of at every page load, and the server line keeps only what changed. The dashboard and `bb performance summary` read the same.
