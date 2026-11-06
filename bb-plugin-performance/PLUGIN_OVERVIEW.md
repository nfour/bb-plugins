## What you get

A **Performance** tab in BB's nav that shows how far BB is from feeling native while you use it: how long frames take, how fast typing and clicks reach the screen, how long a thread switch, a panel and the first start take, how busy BB is when you are doing nothing, and whether its memory grows. Each is set against a target: a score at the top says how many are within it, a card per metric shows how far along its bar it is, and charts below show how each moved over the last 15 minutes or hour.

Further down, bars show who ran inside the slow frames (BB itself or which plugin) and what you were doing at the time, and dots on a time axis mark every slow frame and every thread switch. A list of your plugins shows which one is behind a slowdown: the time its scripts ran inside slow frames, its start time, how many of its style rules BB checks against every element on the page, and how often its server code ran. Each slow frame is split into script, layout the script forced, style and layout, and other tasks, and called script-bound or render-bound, so you can see whether the cost is BB's code, a plugin's, or the browser laying the page out. Each plugin row opens to show its trend, what started its script, its bundle size, and the class names behind its page-wide style rules. The nav icon carries a badge with the biggest gap as a multiple of its target, so a problem shows without opening the tab.

The numbers come from your real sessions, always on, with nothing spent on tokens. They are also written to a JSONL file a day under `~/.bb/plugins/performance/metrics/`, which a bot can read and compare against the targets.

## Using it

- Open the **Performance** tab. Choose the last 15 minutes or the last hour.
- Use BB as usual: scroll, type, switch threads, open the right panel. A metric reads "no data" until you have done it. Memory growth needs ten minutes.
- Click a column heading in the Plugins list to sort by it. A plugin carries a flag when its scripts ran 100 ms or more in slow frames in the period, holds 300 or more page-wide style rules, took 40 ms or more to start, or its server code failed.
- Open a plugin row (the arrow beside its name) to see everything known about it.
- **Run benchmark** switches between your recent threads and times each switch, so a change can be compared before and after. **Compare plugin CSS** runs the benchmark again with every plugin stylesheet switched off, to show how much of a switch is plugin CSS. **Probe CSS** times what each plugin's stylesheet adds to a style recalculation (the page freezes for a few seconds). **This lagged** marks a lag you just felt so it can be found later. **Pause 15 min** stops measuring. **Copy report** puts a markdown summary on the clipboard for a thread.
- **Flush now** in the tab's header sends what is gathered so far; otherwise the plugin sends about once a minute.

## Options

**Performance** in a thread's actions menu (⋯ in the thread header): **Measure** (off attaches nothing to the page), **Write the metrics file**, **Sample the server**, **This lagged**, and **Open the dashboard**.

## Requirements

- BB 0.48 or later, on a Chromium-based page (BB's desktop app and browser).
- Plugin back-ends run inside BB's server process, so their cost is shown together under **Server**, not per plugin; only plugins with their own worker process have a memory and CPU figure.
- No message text, file names, titles or ids are written to the file. No external service or account is used.
