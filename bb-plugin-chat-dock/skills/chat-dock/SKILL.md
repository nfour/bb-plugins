---
name: chat-dock
description: Explain, configure or debug the Chat Dock plugin, which moves BB's composer into the thread's right panel while it is open. Use when the user asks why the composer is or is not in the panel, how to switch between the bottom strip and the Chat tab, how Keep composer docked and the Return composer row work, how to get the dock button back, or when the composer lands in the wrong place.
---

# Chat Dock

While a thread's right panel is open, the composer (the box, the cards above it and the chips under it) moves out of the chat column into the panel. BB's own composer is moved, not rebuilt, so the draft and everything inside it come along and go back when the panel closes.

## Modes

- **Keep it at the panel's bottom** (`locked`, on by default): a strip under whichever tab is open; the tab shrinks to make room.
- **Chat tab** (`locked` off): a fixed Chat tab holds the composer while it is the active tab in its pane; otherwise the composer is in the column.

`enabled` switches docking off altogether.

Hiding the right panel (Ctrl+J) puts the composer back in the column in either mode, unless **Keep composer docked** is on. On a phone-width screen the panel is a drawer and the composer docks at its bottom.

## Keep composer docked

With `keepDocked` on, closing or swiping away the panel leaves the composer docked: it stays mounted in its column but out of sight, so the draft, the caret and the cards above it are as they were. A dashed **Return composer** row takes its place at the bottom of the timeline, showing the start of the draft; pressing it puts the composer back. Return is one-off, not a setting: the next panel open docks the composer again. With a mouse or trackpad the caret goes into the box on Return; on a touch screen the keyboard stays down until the box is tapped. In Chat-tab mode the composer is kept docked only if it was docked when the panel closed; switching to another tab with the panel open puts it in the column as usual. Leaving the thread drops the kept state; BB still keeps the thread's draft.

## The phone drawer

BB renders the drawer outside the app's React root, where BB's own buttons would not respond, so in the drawer the composer stays in the app and is laid over the drawer's bottom, with a spacer of the same height in the drawer. The overlay takes the drawer's own height (`--bb-shell-height`), which BB fits above the on-screen keyboard, so the composer rises with it. The composer footer (environment, permission mode, context meter) appears when the box is tapped, as in the timeline. In the side panel, which is usually narrower than 30rem, Chat Dock keeps the footer showing, where BB would otherwise fade it out.

## Settings

The dock button in the composer's action row (beside the microphone) switches `enabled`. Every option is in **Chat dock** in a thread's actions menu (⋯ in the thread header), or use `bb plugin config chat-dock`. All are booleans:

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | on | Dock the composer in the right panel at all. |
| `locked` | on | Dock as a strip at the panel's bottom; off, as a Chat tab. |
| `keepDocked` | off | Keep the composer docked when the panel closes, with a Return composer row in the timeline. |
| `showButton` | on | The dock button in the composer. |
| `debugLog` | off | Dock and undock lines in the plugin log. |

BB hides composer actions when the composer is in its compact one-line layout and on phone-width screens, so the button is absent there; use the thread menu or `bb plugin config chat-dock` instead.

## Debugging

Switch on `debugLog`, then `bb plugin logs chat-dock`. Lines: `dock` (`to` strip or tab, the composer's height, `adopted` when the strip took it from the tab), `undock` (`from`, `reason`: panel closed, thread changed, parked for the strip, …; `stowed` when it was kept docked) and `rehome` (the strip moved into the panel BB rebuilt after a setting change).

The plugin moves BB's undocumented page elements (`[data-app-composer]`, `#thread-detail-secondary-panel`, `[data-testid=secondary-panel-shelf]`, `#root`), follows `--bb-shell-height` and overrides one BB style rule (`[data-follow-up-composer-footer]`). If the composer stops docking after a BB update, those are the first thing to check.
