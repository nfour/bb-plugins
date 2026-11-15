# Pinned Turns: design notes

Pins the message you are reading under and the latest reply to the top of the timeline. User docs are in `README.md`; this file is for whoever changes the code.

## Layout

- `src/model.ts`: the pure rules. `bandAt` (what the bar says at a boundary row) is tested against the plain `bandContent` oracle; `lastAtOrAbove`, `turnStatus`, `oneLine`, `dataIdOf`, and the jump's steering: `jumpOffset` (where a row must land), `jumpStep` (this frame's move toward a mounted row: a share of what is left, 1px at least, 1.5 viewports at most), `searchStep` (a screen toward a row that is not mounted), `ARRIVED_PX`, `JUMP_EASE`.
- `src/shared.ts`: import-free; the setting keys, their defaults and `HALVES`, read by `server.ts`, `src/options.ts` and `src/ThreadMenu.ts`. Page code may import only types from `server.ts`; a value import bundles the server's SDK and zod into `app.js` (217 KB instead of 23 KB).
- `src/rows.ts`: timeline rows to an index. `flatten`, `mergeNewest`, `prependOlder`, `applyDelta`, `indexOf` (titles, ranks, turn status), `outlineOf` (turn counter). `indexOf` takes a `Titles` memo (per thread, by row id, keyed on what a title is made from: text, mentions, attachments, initiator) so a delta only reads the text of rows that changed, and a message whose fields did not change is handed out as the same object. Measured on synthetic rows: 600 rows 9.2 ms without, 0.18 ms with; 2,000 rows 36 ms against 1 ms.
- `src/watch.ts`: the timeline watcher, no React import, so `src/watch.test.ts` runs it under `node --test` with `mock.timers` and a fake SDK. `src/timeline.ts` holds the hooks (`useTimeline`, `useOutline`) around it.
- `src/PinnedTurns.tsx`: one bar per thread; `src/dom.ts` finds BB's scroller; `src/viewport.ts` (counter room, hover, tab visibility); `src/ThreadMenu.ts` + `src/options.ts` + `server.ts` the options.

## Reading the timeline

- The newest page is kept with its `tag`. A refresh asks `afterTag` with `deferContent: "true"`; `applyDelta` rebuilds the page (a few KB instead of ~80 KB). A delta that does not fit, `history-rewritten`/`history-compacted` and 60 s since the last full page read it in full. A delta also carries `fields.timelinePage.olderRowUpdates`.
- `deferContent` is safe: the bar reads only a message's text and a row's kind, status, `systemKind` and `operationKind`; `contentDeferred` is only on tool/operation rows.
- Older pages come on demand (`loadOlder`) when a half is missing and `hasOlder`. A rewrite while one is in flight drops it (`epoch`).
- Nothing is read while the bar is not on the page or the tab is in the background (`active`): signals only mark the rows stale and becoming active reads once. The counter's `conversationOutline` read follows the same rule. Bursts of signals are read once after 300 ms of quiet, at the latest every 1 s.
- The turn counter comes from `conversationOutline` (the user messages, one small response), read again when the newest user message changes; that response has no `initiator`, so another agent's message is recognised by its `[bb message from thread:...]` envelope.

## The bar

- A zero-height row stuck to the top is the first child of the scroller's frame, so layout and scroll height do not change. One paint per animation frame, driven by scroll and a ResizeObserver; paint binary-searches the mounted rows' tops for one boundary row and answers everything above it from the data.
- One bar per pane: BB hands a plugin only the focused thread (`useBbContext`), so `app.tsx` reads each timeline's thread off the page (the prefix of its first `data-timeline-row-id`) with `usePaneThreads`, a 1 s scan that stops while the tab is in the background. Checked headless in a split (Ctrl-click a thread link in the sidebar): each pane has its own bar naming its own thread. Before this a split had a bar on the focused pane only.
- Attaching: a MutationObserver (childList only, no subtree, on the frame and 6 boxes above it) re-attaches when BB replaces the scroller, frame or items, retrying for up to 30 frames while the new timeline has no rows yet. It replaced a 500 ms `setInterval`; removing the bar's host element by hand brought it back within 300 ms.
- Jumps steer by the row's live position every frame (BB re-measures rows mid-scroll; a single `scrollTo` ends up elsewhere), never touch the URL or history, and end on the reader's own input. BB 0.48's scroll keeper writes an unexplained scroll back to the bottom while attached there, so every jump frame first dispatches a `wheel` event on the scroller.
- `halves` (both / message / reply) is a string setting set through `set_halves`; the menu shows it as three rows above the other options. Reply only has no counter.

## Measured and left alone

- Paint per scroll frame (`PinnedTurns.tsx` `paint`: mounted-rows list, the scroller's rect, a binary search over a few row tops) replayed after each scroll write on a thread of 19,000px: median 0.1 ms, worst 0.2 ms including the layout read. Not worth caching row tops.
- `conversationOutline` as the bar's source instead of timeline pages (spike, on a 547-message thread of this repo's checkout): one read is 147 KB / 10 ms for the whole thread, against 16 pages / 674 KB / 660 ms to walk its timeline back to the start. But it has no tag or delta (every new reply would re-read 147 KB; the timeline delta is about 1 KB), it carries no turn status (errors, interruptions and pending come from system rows it leaves out), its previews are raw (`@thread:thr_x` for a mention, 4 of the 5 mention rows; `[bb system]` kept) and cut at 200 characters (43 of 210 user messages; the bar's title is 240 and its tooltip 800), and another agent's message is told apart only by its envelope. The gain is only on a far scroll up, which costs a few pages; not adopted. The turn counter keeps using it (`role=user`, 43 KB on that thread, read when the newest message changes).

## Options

A `choices` submenu of a thread action (`src/ThreadMenu.ts`; BB 0.48 retired the header-button slot and header actions cannot hold choices). Booleans go through `set_setting`, written by the backend because the page can only read settings. Options that cannot apply (counter under 840 px, full text without hover) are greyed with the reason.

## Gotchas

- Styling: no utility words anywhere in the folder (code, comments, docs): `bb plugin build` turns many ordinary words (the names of Tailwind utilities) into a page-wide `:where([data-bb-plugin=...]) .word` rule. Check `dist/app.css` after a build (count must be 0; the file is one line, so count with `grep -o ... | wc -l`). Classes are `pinned-*` in `src/styles.css`.
- BB page facts: timeline scroller `[data-page-scroll-viewport]`; rows `[data-timeline-row-id]`; virtualised at 20 or more top-level rows (`[data-timeline-window-spacer]`); BB folds runs of work into `…:work-summary:<data id>` rows (`dataIdOf`). Undocumented, can change.
- Headless: use `page.mouse.click`; a split is made with a Ctrl-click on a sidebar thread link.
