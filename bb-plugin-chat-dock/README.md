# Chat Dock

A BB plugin. While a thread's right panel is open, it moves the composer, the cards above it (running commands, child threads, questions) and the chips under it out of the chat column and into the panel, so the timeline keeps its width. What it does in each situation is in [PLUGIN_OVERVIEW.md](PLUGIN_OVERVIEW.md).

![The composer docked at the bottom of the right panel, under the Info tab](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-strip.png)

![The Chat dock submenu in the thread's actions menu](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/chat-dock-menu.png)

## Use it

- The **dock button** in the composer's action row (beside the microphone) switches docking on and off.
- **Chat dock** in the thread's actions menu (⋯ in the thread header, or a sidebar row's menu) holds the options, with a check beside each one that is on. They are also plugin settings (`bb plugin config chat-dock`); [the skill](skills/chat-dock/SKILL.md) lists them.
- Two commands in BB's command palette do what the dock button and the thread menu's strip switch do: **Chat Dock: toggle docking the composer** and **Chat Dock: switch between the panel's bottom strip and a Chat tab**. Give them a key in BB's shortcut settings.

Two ways to hold the composer:

- **Keep it at the panel's bottom** (the default): a strip under whichever tab is open, so the composer never goes away while the panel is open. The open tab shrinks to make room; nothing is covered.
- Switched off, a **Chat** tab of its own: the composer is in the panel while that tab is the active one in its pane, and in the column otherwise. The tab splits and drags like any other.

Hiding the right panel (Ctrl+J) returns the default layout either way.

## Notes

Nothing is re-implemented: BB's own elements are moved in the DOM and moved back, which is undocumented, so a future BB release may need a plugin update. How it works, and what to keep in mind when changing it, is in [NOTES.md](NOTES.md).
