---
name: pinned-turns
description: Explain, configure or debug the Pinned Turns plugin, which pins the user message and latest agent reply you are reading under to the top of a thread. Use when the user asks why the bar is or is not showing, how to turn it off or change its options, or when its titles or jumps look wrong.
---

# Pinned Turns

While you scroll a thread, a bar at the top shows the user message you are reading under and the latest agent reply. Clicking either half jumps to that message.

## Settings

Use the **Pinned turns** submenu in a thread's actions menu (⋯ in the thread header), or `bb plugin config pinned-turns`. All are booleans except `halves`:

| Key | Default | Effect |
| --- | --- | --- |
| `enabled` | on | The bar itself. |
| `halves` | `both` | `both`, `message` (only the message you are under) or `reply` (only the latest reply). |
| `showStatus` | on | Your message and the reply pulse while the turn runs; a dot marks one that failed or was interrupted. |
| `showPinButton` | on | The Pinned turns submenu in thread menus. |
| `showPosition` | on (the turn counter) | `7/23` outside the message's right edge; counted from the thread's `conversationOutline` (one small request). |
| `showFullText` | on | Tooltip with the whole message when the bar cut it short. |
| `debugLog` | off | Timing lines in the plugin log. |

## How it reads the thread

The newest page of the timeline is read once, then kept current with deltas: a refresh asks only for what changed since the last read (`afterTag`, about 1 KB, against 70 to 80 KB for a page) and tool rows' content is left out. A change that does not fit what is held, a rewrite of history (`history-rewritten`, `history-compacted`) and 60 s since the last full page read the whole page again. Older pages are read only when a half of the bar is missing and older rows exist. A burst of thread changes is read once, after 300 ms of quiet and at the latest every second.

Nothing is read while the bar is not on the page or the tab is in the background; changes only mark the data stale, and one read catches up when the bar or tab comes back. So a bar that looks stale in a background tab is normal; it updates on return. The turn counter reads BB's `conversationOutline` (one small request) again only when the newest user message changes.

## Debugging

`bb plugin logs pinned-turns` prints the log (switch **Debug log** on first). Lines:

- `load` and `older`: timeline fetches (`ms`, `rows`, `more`).
- `attach` and `detach`: the bar finding or losing BB's scroller.
- `jump`: outcome and `ms`.
- `timeline`, every 5s of activity: `signals` (thread changes), `refetches` (reads they caused), `deltas` (how many of those were small deltas), `errors`, `fetchMsMax`, `rows`.

A reply title that stays stale while `signals` keeps rising and `refetches` stays near zero means the refetch debounce is starving. `refetches` well above `deltas` means full pages are being read (a rewrite, or a delta that did not fit).
