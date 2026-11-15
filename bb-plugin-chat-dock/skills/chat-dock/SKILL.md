---
name: chat-dock
description: Explain, configure or debug the Chat Dock plugin, which moves BB's composer into the thread's right panel while it is open. Use when the user asks why the composer is or is not in the panel, how to switch between the bottom strip and the Chat tab, how to get the dock button back, or when the composer lands in the wrong place.
---

# Chat Dock

While a thread's right panel is open, the composer (the box, the cards above it and the chips under it) moves out of the chat column into the panel: a strip under the open tab (`locked`, the default) or a Chat tab. BB's own composer is moved, not rebuilt, so the draft goes along and comes back when the panel closes. What it does in each situation is in the plugin's `PLUGIN_OVERVIEW.md`.

## Settings

All booleans. The dock button in the composer's action row switches `enabled`; every option is in **Chat dock** in a thread's actions menu (⋯ in the thread header), or use `bb plugin config chat-dock`. The two palette commands flip `enabled` and `locked`.

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | on | Dock the composer in the right panel at all. |
| `locked` | on | Dock as a strip at the panel's bottom; off, as a Chat tab. |
| `showButton` | on | The dock button in the composer. |
| `debugLog` | off | Dock and undock lines in the plugin log. |

BB hides composer actions when the composer is in its compact one-line layout, and on phone-width screens until the box is expanded, so the button is absent then; use the thread menu or `bb plugin config chat-dock` instead.

## Debugging

Switch on `debugLog`, then `bb plugin logs chat-dock`. Lines: `dock` (`to` strip or tab, the composer's height), `move` (`from`, `to`: the lock switched and the composer went straight across), `undock` (`from`, `reason`: panel closed, no tab, tab closed, thread changed, shell replaced, pane gone, off) and `rehome` (the strip moved into the panel BB rebuilt after a setting change).

The plugin moves BB's undocumented page elements: `[data-app-composer]`, `#thread-detail-secondary-panel` (in a split workspace `#thread-detail-secondary-panel-<pane id>`, one panel that follows the focused pane) and `[data-testid=secondary-panel-shelf]` (the phone drawer). On a phone the docked composer sits in `.chat-dock-overlay`, a child of `#root`, with `[data-chat-dock-spacer]` holding its place in the drawer; a composer whose buttons do nothing there is one that ended up inside the drawer itself. If the composer stops docking after a BB update, those are the first thing to check.
