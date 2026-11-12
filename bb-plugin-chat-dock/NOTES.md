# Chat Dock: design notes

For whoever changes the plugin next. User docs are in `README.md`; the list of settings and the log lines are in `skills/chat-dock/SKILL.md`.

## What it does

While a thread's right panel is open, BB's own composer shell (`[data-app-composer]`: the box, the cards above it, the chips under it) is moved into the panel with `moveInto` (`src/dom.ts`). It leaves a comment marker where it was and puts the shell back, so the draft survives. Nothing is re-rendered: BB owns every element involved.

- **Strip** (`locked`, the default): `src/Strip.tsx`, an app overlay that renders nothing. For every chat pane whose panel is open it appends a host (`createStripHost`) to the panel's column, under the tab body, and moves the shell in.
- **Chat tab** (`locked` off): `src/Dock.tsx`, the body of a plugin tab. While mounted it holds the shell at its bottom.
- Switching between the two is one move: the tab parks the shell in a strip host (`park`) and the strip takes it over (`adopt`), so it never passes through the column.
- Docking goes through `dockInto(shell, host, panel)`. In the split panel that is `moveInto`; in the phone drawer it is the overlay below.

## Finding things (`src/dom.ts`)

- Layout roots are `[data-split-resize-grid-root]`; in a split workspace they nest. The panel is `#thread-detail-secondary-panel`, or in a split workspace `#thread-detail-secondary-panel-<pane id>` (a single panel that moves to the focused pane; its `-handle` sibling is not a panel). `PANEL` matches both. The shell that belongs to a split panel is the one in the pane the id names, not the first in the root (`shellFor`); the panel's own tabs are split panes with ids of their own, so panes inside the panel are skipped.
- `findPanel` returns the panel, its aside and its column: the aside's child that wraps the tab strip. With several tiles `lowestStrip` picks the bottom one, then the leftmost (by rect, with 1px of slack); tile order in the DOM is creation order, not screen order.
- Closed panels: `panelHidden` is `data-panel-size <= 0`, `inert` (the drawer) or `aria-hidden` on the aside.
- Every check runs from one page-wide MutationObserver (`observePage`), so it lands in the same task as BB's change, before a paint. `structural` keeps it cheap: a change counts only if a node added or removed is, or holds, a piece of the layout (`STRUCTURE`), or an attribute changed on a panel, drawer or aside. A panel's own tab (a diff, a terminal) streams constantly and is ignored; so is anything inside the timeline or the composer. A 2s backstop timer (`every`, `BACKSTOP_MS`) covers what the observer cannot see; it sleeps while the tab is in the background and runs once on `visibilitychange`.
- Measured headless (strip docked, 5s): `findPanes` calls fell from 21 (idle) and 39 (a busy panel body, 30ms between changes) to 2 and 3.

## The phone drawer (`src/overlay.ts`)

BB portals the drawer (`[data-testid=secondary-panel-shelf]`) to `body`, outside `#root`, and React ignores events whose target is outside the root it rendered into. A shell moved into the drawer takes typing (TipTap listens natively) but none of its buttons, and never expands. So in the drawer the shell stays inside the root: a layer appended to `#root` (position set from script, see the build note below), sized to the drawer's content box and z-index plus one by a `ResizeObserver` on the drawer, with a frame at its bottom that holds the shell. The host left in the drawer keeps the frame's height (a `ResizeObserver` on the frame) and `aria-owns` it, since the drawer is an `aria-modal` dialog and assistive technology may skip what is outside it. `holdsShell`/`heldShell` look in the overlay; a host whose drawer BB replaced counts as empty, so it docks again over the new one.

- No script runs on scroll, tap or drag. BB 0.49's open drawer never slides: opening animates its width, and a swipe moves the page under it. A `transitionend` on the drawer covers a later BB that slides it.
- BB's keyboard handler sets `--bb-shell-height` (visual viewport height) and `--bb-safe-area-bottom: 0px` on `body`; the drawer's height is that variable. The layer copies the drawer's real box, so it does not read the variable itself.
- z-index: the drawer is 45, toasts 49, menus 50; the layer is 46.
- A phone's composer behaves as under the timeline: a tap expands it and shows the footer. The footer rule below is deliberately not applied to the overlay frame.
- BB hides composer actions on a phone until the box is expanded, so the dock button shows only then.

## The footer in a narrow side panel

BB fades `[data-follow-up-composer-footer]` out under an unlayered style query on `--follow-up-composer-container-compact` (composer 30rem wide or less, or the thread pane 26rem tall or less; the side panel is outside the pane's query scope) until the composer is expanded. In the strip and tab hosts `all: revert-layer` undoes that: BB's rule is unlayered, the footer's normal values are layered utilities, and plugin CSS is unlayered too, so only BB's rule is dropped. Do not override the compact variable instead: the composer also reads it for its one-line layout (it grew from 94px to 192px).

## The dock button and options

- `DockButton` is a composer action; it only flips `enabled`. A document capture-phase `pointerdown` guard keeps BB's composer from expanding on the click. Headless checks need `page.mouse.click` on it.
- Its chevron follows the setting (`aria-pressed`), not where the composer is this moment: on a phone with the drawer closed the composer is under the timeline while docking is on, and a chevron that followed the composer pointed the wrong way for a tap that only turns docking off.
- Options are a `choices` submenu of a thread action (`src/ThreadMenu.ts`), written through the backend's `set_setting` RPC (the page can read settings but not write them). `server.ts` also takes `debug` lines, kept only while `debugLog` is on.
- Palette commands (`src/Commands.tsx`, registered in `app.tsx`): toggle `enabled`, and switch `locked` (listed only while docking is on). A command's `run` is not a component, so an overlay renders nothing and keeps the current options and RPC client in a module variable.
- Setting writes remount the right panel's content; `Strip` re-homes its host into the fresh column (`rehome`).

## Testing

- Headless (`bb browser-automation open --backend local --machine wsl --headless`): the screenshots must be JPEG. Viewport via `page.setViewport`. A split workspace is made by a Ctrl-click on a thread link in the sidebar; click a pane's timeline to focus it.
- Changing `locked` to test the Chat tab writes the user's real setting. Rewrite `GET /api/v1/plugins/chat-dock/settings` in a headless page instead.
- Keyboard on a phone can only be simulated by setting `--bb-shell-height` and `--bb-safe-area-bottom` on `body`.

## Build gotchas

`bb plugin build` turns any Tailwind utility word standing alone anywhere in the folder (code, comments, this file) into a rule matched page-wide. That covers the words for position, visibility, display and box sizing; `dist/app.css` shows which ones tripped it. Where the code needs one it is built from two strings (the overlay layer's position and the SDK's tab `availability` are joined from halves; the page-state check compares against a joined string). Write `chat-dock-*` classes in `src/styles.css`, then check that `dist/app.css` has no `:where([data-bb-plugin=` rule.

## Known gaps

- A mobile "stow the draft" button was tried as a PR and dropped: hiding the whole shell also hides the agent's question and approval cards. If revisited, stow only the box element.
- The strip has no height cap, so a tall composer in a short panel can squeeze the tab body.
- Chat-tab mode in a split workspace was not tested live.
