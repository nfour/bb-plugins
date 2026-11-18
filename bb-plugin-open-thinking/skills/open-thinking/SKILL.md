---
name: open-thinking
description: Explain, configure or debug the Open Thinking plugin, which opens the agent's thinking blocks by itself and can close them when a new one arrives or the turn finishes. Use when the user asks why thinking is or is not open, how to turn it off or change its options, or when it fights with their own clicks.
---

# Open Thinking

BB shows the agent's reasoning as a "Thinking…" line while it streams and a "Thought" row afterwards, both closed until clicked. Open Thinking clicks them open.

## Settings

Use the **Open thinking** submenu in a thread's actions menu (⋯ in the thread header), or `bb plugin config open-thinking`. All are booleans:

| Key | Default | Effect |
| --- | --- | --- |
| `autoExpand` | on | Opens all the thinking on screen. Off: the plugin attaches nothing and leaves blocks as BB shows them. |
| `closeOnNew` | off | Only the newest thinking on screen stays open. |
| `closeOnFinish` | off | Thinking closes when the turn ends, and thinking in finished turns stays closed. |
| `keepLatest` | on | While the turn works, keeps the group holding the newest thought open, so the latest reasoning stays readable while tools run. |
| `followGrowth` | on | The live "Thinking…" line's text scrolls to its end as it grows, until the reader scrolls up in it. |

The other options only apply while `autoExpand` is on.

## What it can and cannot open

It opens thinking that is on the page. BB folds "Thought" rows into its work groups ("Ran 4 commands") and a finished turn into one "Worked for" row; a folded group takes its thinking off the page, and the plugin unfolds only the group that holds the newest thought, while the turn works (`keepLatest`). So a "Thought" is open while it streams and until different work follows it, and when the reader unfolds a group its thinking opens (or stays closed under `closeOnFinish`).

## Why thinking is not what the settings say

- **The reader's own click.** Thinking opened or closed with a real click is left alone until the page reloads (the list is per page session, not saved).
- **Keep Last Blocks Open** with Thought counting on also clicks these toggles; turn counting off there.
- **BB changed its markup.** The plugin finds rows by the `data-timeline-row-id` attribute, an id shape `…:op:reasoning:…`, and each row's own `button[aria-expanded]`; the live line by its "Thinking…" title. If a BB update renames them the plugin does nothing.
- **Status not known yet.** With `closeOnFinish`, a thought outside a "Worked for" row is left alone until the thread's status has been read (a moment after the page loads).
