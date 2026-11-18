# Open Thinking

Opens the agent's thinking by itself. While an agent works, BB's "Thinking…" line shows its text as it streams, and the "Thought" row it turns into arrives already open. Two options close thinking again: when a new thought arrives, and when the turn finishes.

## What you get

- **Open thinking blocks** (on by default): all the thinking on screen opens. The "Thinking…" line shows its text while it streams, and each "Thought" row opens as it lands in the thread. A "Thought" row that comes on screen later (you unfold a "Worked for" row, or a group such as "Ran 3 commands") opens too.
- **Close earlier thinking blocks when a new one arrives** (off by default): only the newest thinking on screen stays open.
- **Close thinking blocks when the turn finishes** (off by default): when the agent's turn ends its thinking closes, and thinking inside finished turns stays closed.
- **Keep the latest thinking in view while the turn works** (on by default): BB folds a thought into a work group such as "Ran 3 commands" as soon as different work follows, and a folded group takes its thinking off the page. This keeps the group that holds the newest thought open, so the agent's latest reasoning is always readable while it runs tools. It never opens anything while the turn is not working.
- **Scroll growing thinking to its end** (on by default): the "Thinking…" line's text scrolls to its end as it streams past the height of its box, until you scroll up in it; scroll back to the end and it follows again.
- **Your clicks win.** Thinking you open or close yourself is left as you set it until the page is reloaded.

Open thinking is BB's own: its text is capped in height with its own scrollbar. The plugin adds no element and no colour.

## What it does not do

BB folds "Thought" rows into its work groups, and a folded group takes its thinking off the page. Open Thinking opens thinking that is on the page. Apart from keeping the group that holds the newest thought open (while the turn works), it does not unfold groups or "Worked for" rows. If BB merges a whole step into one group after a message of yours (a steer), the plugin may lose track of where the newest thought went until the next one lands.

## Settings

Pick **Open thinking** in a thread's actions menu (the ⋯ in the thread header), or open the plugin's page in BB's settings. The options are the same for every thread. The other options do nothing while **Open thinking blocks** is off; with it off the plugin leaves all thinking as BB shows it and attaches nothing to the page.

A change applies at once, no reload.

## How it works

It reads BB's page, not the thread's data. One observer on the page notices a new thinking row or "Thinking…" line and clicks its own toggle, the same click you would make. It needs no timer and does nothing while the tab is in the background; one look on return catches up. Whether a turn is over comes from the thread's status, which BB sends as it changes.

Each timeline on the page is handled separately, so in a split workspace each pane follows its own thread.

## Limits

- It depends on BB's own markup (checked on bb 0.49 and 0.50.1), which is not documented and can change. If it changes the plugin does nothing; it cannot click anything that is not a thinking toggle.
- If **Keep Last Blocks Open** is also installed with Thought counting on, the two can disagree about a thought. Turn Thought counting off there.
- Closing a thought with **Close thinking blocks when the turn finishes** is a click, so BB animates it.
