---
name: pinned-turns
description: Explain, configure or debug the Pinned Turns plugin, which pins the user message and latest agent reply you are reading under to the top of a thread. Use when the user asks why the bar is or is not showing, how to turn it off or change its options, or when its titles or jumps look wrong.
---

# Pinned Turns

While you scroll a thread, a bar at the top shows the user message you are reading under and the latest agent reply. Clicking either half jumps to that message.

## Settings

Use the **Pinned turns** submenu in a thread's actions menu (⋯ in the thread header), or `bb plugin config pinned-turns`. All are booleans:

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | on | The bar itself. |
| `showStatus` | on | Your message and the reply pulse while the turn runs; a dot marks one that failed or was interrupted. |
| `showPinButton` | on | The Pinned turns submenu in thread menus. |
| `showPosition` | on (the turn counter) | `7/23` outside the message's right edge; counted from the thread's `conversationOutline` (one small request). |
| `showFullText` | on | Tooltip with the whole message when the bar cut it short. |
| `debugLog` | off | Timing lines in the plugin log. |

## Debugging

`bb plugin logs pinned-turns` prints the log. Debug lines: `load` and `older` (timeline fetches), `attach`/`detach` (the bar finding or losing BB's scroller), `jump` (outcome, ms), and a `timeline` summary every 5s of activity with `signals` against `refetches`. A reply title that stays stale while `signals` keeps rising and `refetches` stays near zero means the refetch debounce is starving.
