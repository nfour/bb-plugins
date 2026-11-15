# Chat Dock: design notes

For whoever changes the plugin next. User docs are in `README.md`; the list of settings and the log lines are in `skills/chat-dock/SKILL.md`.

## What it does

While a thread's right panel is open, BB's own composer shell (`[data-app-composer]`: the box, the cards above it, the chips under it) is moved into the panel by `dockShell` (`src/dom.ts`). It leaves a comment marker where it was and puts the shell back, so the draft survives. Nothing is re-rendered: BB owns every element involved.

One module decides where every pane's shell is: `src/reconcile.ts`. The parts that feed it hold no state of their own.

- `src/Docking.tsx`: an app overlay that renders nothing; passes whether a thread is showing, the options (`ready`, `enabled`, `locked`) and the debug logger to `configure`/`setLog`.
- `src/Dock.tsx`: the body of the Chat tab (a plugin tab, offered while `locked` is off). It registers its body with `registerTab` while mounted, and also passes the options to `configure`: its React root often learns of a switch of the lock before the overlay's does, and a tab told first can send its shell straight to the strip.
- `reconcile()` looks at the page and, per pane (by layout root), asks `plan` (`src/model.ts`, pure and tested) what to do about it, from where the shell belongs (`want`: its column when docking is off or the panel is closed or there is no Chat tab; the strip when `locked`; the tab's body otherwise), where it is held (`held`), whether the column offers a shell and whether the held place still has one: `hold`, `release`, `replace` (a new shell appeared in the column while one was held: the thread changed under the panel), `move` or `keep`.
- `move` is the switch of the lock: the shell goes from the strip to the tab's body or back with `Dock.moveTo`, keeping its marker, so it never passes through the column. Should the tab be gone before the reconciler hears of the lock (its root learnt of the setting last), the shell is released to the column and the strip takes it from there; the headless runs never saw that order.
- Strip hosts are made by `createStripHost` and appended to the panel's column, under the tab body; the tab's own body is its host. A phone drawer's host is an overlay (below); `dockShell` swaps the overlay when the shell moves.
- The page-wide observer and the 2s backstop run only while something could be docked (`sync`): docking is on and the lock is on or a Chat tab is mounted.

## Finding things (`src/dom.ts`)

- Layout roots are `[data-split-resize-grid-root]`; in a split workspace they nest. The panel is `#thread-detail-secondary-panel`, or in a split workspace `#thread-detail-secondary-panel-<pane id>` (a single panel that moves to the focused pane; its `-handle` sibling is not a panel). `PANEL` matches both. The shell that belongs to a split panel is the one in the pane the id names, not the first in the root (`shellFor`); the panel's own tabs are split panes with ids of their own, so panes inside the panel are skipped.
- `findPanel` returns the panel, its aside and its column: the aside's child that wraps the tab strip. With several tiles `lowestStrip` picks the bottom one, then the leftmost (by rect, with 1px of slack; the rule is `lowestIndex` in `src/model.ts`); tile order in the DOM is creation order, not screen order.
- Closed panels: `panelHidden` (rule in `isShut`, `src/model.ts`) is `data-panel-size <= 0`, `inert` (the drawer) or `aria-hidden` on the aside.
- Every reconcile runs from one page-wide MutationObserver (`observePage`), so it lands in the same task as BB's change, before a paint. `structural` keeps it cheap: a change counts only if a node added or removed is, or holds, a piece of the layout (`STRUCTURE`), or an attribute changed on a panel, drawer or aside. A panel's own tab (a diff, a terminal) streams constantly and is ignored; so is anything inside the timeline or the composer. A 2s backstop timer (`every`, `BACKSTOP_MS`) covers what the observer cannot see; it sleeps while the tab is in the background and runs once on `visibilitychange`.
- Measured headless (strip docked, 5s): `findPanes` calls fell from 21 (idle) and 39 (a busy panel body, 30ms between changes) to 2 and 3.

## The phone drawer (`src/overlay.ts`)

BB portals the drawer (`[data-testid=secondary-panel-shelf]`) to `body`, outside `#root`, and React ignores events whose target is outside the root it rendered into. A shell moved into the drawer takes typing (TipTap listens natively) but none of its buttons, and never expands. So in the drawer the shell stays inside the root: a layer appended to `#root` (position set from script, see the build note below), sized to the drawer's content box and z-index plus one by a `ResizeObserver` on the drawer, with a frame at its bottom that holds the shell. The host left in the drawer keeps the frame's height (a `ResizeObserver` on the frame) and `aria-owns` it, since the drawer is an `aria-modal` dialog and assistive technology may skip what is outside it. `holdsShell`/`heldShell` look in the overlay; a host whose drawer BB replaced counts as empty, so the reconciler releases it and docks again over the new one.

- No script runs on scroll, tap or drag. BB 0.49's open drawer never slides: opening animates its width, and a swipe moves the page under it. A `transitionend` on the drawer covers a later BB that slides it.
- BB's keyboard handler sets `--bb-shell-height` (visual viewport height) and `--bb-safe-area-bottom: 0px` on `body`; the drawer's height is that variable. The layer copies the drawer's real box, so it does not read the variable itself.
- z-index: the drawer is 45, toasts 49, menus 50; the layer is 46.
- A phone's composer behaves as under the timeline: a tap expands it and shows the footer. The footer rule below is deliberately not applied to the overlay frame.
- BB hides composer actions on a phone until the box is expanded, so the dock button shows only then.

## The footer in a narrow side panel

BB fades `[data-follow-up-composer-footer]` out under an unlayered style query on `--follow-up-composer-container-compact` (composer 30rem wide or less, or the thread pane 26rem tall or less; the side panel is outside the pane's query scope) until the composer is expanded. In the strip and tab hosts `all: revert-layer` undoes that: BB's rule is unlayered, the footer's normal values are layered utilities, and plugin CSS is unlayered too, so only BB's rule is dropped. Do not override the compact variable instead: the composer also reads it for its one-line layout (it grew from 94px to 192px).

## The dock button and options

- `DockButton` is a composer action; it only flips `enabled`. One document capture-phase `pointerdown` guard (on while any button is mounted; a count of buttons, one per composer) keeps BB's composer from expanding on the click. Headless checks need `page.mouse.click` on it.
- Its chevron follows the setting (`aria-pressed`), not where the composer is this moment: on a phone with the drawer closed the composer is under the timeline while docking is on, and a chevron that followed the composer pointed the wrong way for a tap that only turns docking off.
- The settings are one list, `SETTINGS` in `src/shared.ts` (no imports, so the page bundle does not pull in zod): key, label, menu label (`short`), description, default. The backend defines them from it (`definitions()`), the RPC's key enum and `DEFAULTS` are read off it, and `useOptions` and the thread menu follow it; a new option is one entry there and where it is used. `src/shared.test.ts` holds the list to what users' saved values were made against. Page code takes only types from `server.ts`.
- Options are a `choices` submenu of a thread action (`src/ThreadMenu.ts`), written through the backend's `set_setting` RPC (the page can read settings but not write them). `server.ts` also takes `debug` lines, kept only while `debugLog` is on.
- Palette commands (`src/Commands.tsx`, registered in `app.tsx`): toggle `enabled`, and switch `locked` (listed only while docking is on). A command's `run` is not a component, so an overlay renders nothing and keeps the current options and RPC client in a module variable.
- Setting writes remount the right panel's content; the reconciler re-homes the strip's host into the fresh column (`rehome`).

## Testing

- `pnpm --filter bb-plugin-chat-dock test` runs the pure parts: the settings list (`src/shared.test.ts`) and `src/model.test.ts` (`plan`, `lowestIndex`, `isShut`, `paneOfPanelId`). The DOM-heavy parts (`columnOf`, `observePage`, the overlay, `reconcile`) need a headless run.
- Headless (`bb browser-automation open --backend local --machine wsl --headless`): the screenshots must be JPEG. Viewport via `page.setViewport`. A split workspace is made by a Ctrl-click on a thread link in the sidebar; click a pane's timeline to focus it. A fresh session starts single-pane (the split is kept per browser profile).
- Never change the user's real `locked` (or any setting) to test the Chat tab. With `page.setRequestInterception(true)` installed first, answer `GET /api/v1/plugins/chat-dock/settings` with a copy of the real response whose `values` you control, and answer every `POST .../rpc/set_setting` yourself (never `continue()` it). To change a setting live, change your `values` and have BB refetch: its react-query client is on the root fiber (`#root`'s `__reactContainer$…`, a node whose `memoizedProps.client` has `invalidateQueries`); calling it makes BB refetch every plugin's settings. Do not click the dock button for this without the interception in place: its click is a real `set_setting`. In the same pass, a `MutationObserver` on `body` that logs the count of shells in the column, strip, tab and overlay on every change shows whether a switch ever passes through the column.
- Match `button[aria-label*='Hide right panel']` or `'Show right panel'` for the panel's toggle, not `'ight panel'`: the dock button's label contains that too.
- Keyboard on a phone can only be simulated by setting `--bb-shell-height` and `--bb-safe-area-bottom` on `body`.

## Build gotchas

`bb plugin build` turns any Tailwind utility word standing alone anywhere in the folder (code, comments, this file) into a rule matched page-wide. That covers the words for position, visibility, display and box sizing; `dist/app.css` shows which ones tripped it. Where the code needs one it is built from two strings (the overlay layer's position and the SDK's tab `availability` are joined from halves; the page-state check compares against a joined string). Write `chat-dock-*` classes in `src/styles.css`, then check that `dist/app.css` has no `:where([data-bb-plugin=` rule.

## Known gaps

- A mobile "stow the draft" button was tried as a PR and dropped: hiding the whole shell also hides the agent's question and approval cards. If revisited, stow only the box element.
- The strip has no height cap, so a tall composer in a short panel can squeeze the tab body.
