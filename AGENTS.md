# BBPlugins

A pnpm workspace of BB plugins. One folder per plugin, `bb-plugin-<id>/`, each a normal BB plugin package (`package.json` carries the `bb` manifest). Use the `bb-plugin-authoring` skill for the Plugin SDK contract.

## Code here, run it from bb

Write all plugin code in this repo. Never edit a plugin inside `~/.bb/plugins/` — that directory holds BB's runtime state, not source. Link a plugin by path so bb loads this checkout in place:

```sh
bb plugin install ./bb-plugin-<id> --yes   # once per plugin
bb plugin dev ./bb-plugin-<id>             # rebuild + reload on every save
```

## Workspace

- Install with `pnpm install` at the root, never `npm install` in a plugin.
- `pnpm check` typechecks every plugin; `pnpm build` runs `bb plugin build` in each; `pnpm --filter <pkg> test` runs a plugin's `node --test` checks (pinned-turns, diff-plus, lexicon, performance, guest-view, minimap).
- `bb plugin types ./bb-plugin-<id>` repins the SDK when bb upgrades.
- Releases are tags `<id>/vX.Y.Z`; `.bb/plugins.json` indexes the plugins for git installs. Each release bumps `package.json`'s version and adds an entry at the top of the plugin's `CHANGELOG.md` (what a user notices, not the code), in the same commit as the change.
- Styling: no Tailwind utility classes. `bb plugin build` scopes every utility it finds anywhere in the folder (code, comments, README) as `:where([data-bb-plugin="<id>"], …) .flex`, and BB's own elements carry the same class names, so each rule is matched page-wide on every style recalc (most of a thread switch's style time with many plugins). Write prefixed classes (`pinned-*`, `chat-dock-*`, `diff-plus-*`) in `src/styles.css`, imported from `app.tsx`; check `dist/app.css` for `:where([data-bb-plugin=` after a build.

## Plugins

- `bb-plugin-pinned-turns` — pins the message you are reading under and the latest reply to the top of each pane's timeline. `src/model.ts` holds the pure rules, `src/watch.ts` the delta-reading timeline watcher (tested with `mock.timers`), `src/PinnedTurns.tsx` the bar. Options are a `choices` submenu of a thread action written through `set_setting`/`set_halves`. No utility words anywhere in the folder; check `dist/app.css` for `:where([data-bb-plugin=` after a build. Details: `bb-plugin-pinned-turns/NOTES.md`.
- `bb-plugin-chat-dock` — moves BB's composer shell (`[data-app-composer]`) into the right panel with `dockShell` (`src/dom.ts`): a strip under the open tab or a Chat tab (`Dock.tsx`); the phone drawer, outside React's root, gets an overlay in `#root` (`src/overlay.ts`). One reconciler (`src/reconcile.ts`) decides per pane where the shell is, from `plan` (`src/model.ts`, pure, tested); `Docking.tsx` and the Chat tab only feed it. In a split workspace the panel is `#thread-detail-secondary-panel-<pane id>` and the focused pane's composer docks. One structural MutationObserver plus a 2s backstop that sleeps in a background tab, both on only while something could be docked; palette commands in `src/Commands.tsx`. Settings are one list, `SETTINGS` in `src/shared.ts` (import-free; page code takes only types from `server.ts`). Test the Chat tab with an intercepted settings GET, never the user's `locked`. Details: `bb-plugin-chat-dock/NOTES.md`.
- `bb-plugin-performance` — a nav-panel tab that measures how far BB is from feeling native in the user's real sessions (Long Animation Frames per plugin by bundle URL, Event Timing, thread switches, page-wide CSS rules per plugin) and writes JSONL to `~/.bb/plugins/performance/metrics/`. Nothing attaches while off; automated pages (`navigator.webdriver`) never write. No ids, titles or text are stored. Utility words are banned in the whole folder: `dist/app.css` must have 0 `:where([data-bb-plugin=` rules. Details: `bb-plugin-performance/NOTES.md`.
- `bb-plugin-minimap` — a strip over each thread pane's right gutter that stands in for the scrollbar: one rectangle per row (canvas, slider div, hover note), laid out in its own pixels from the thread's timeline data because BB virtualises rows. One strip per pane (`paneThreads` reads threads off the page). Click/wheel glides are its own and write `scrollTop` after a synthetic `wheel` for BB's keeper. Never put a bare Tailwind word anywhere in the folder; check `dist/app.css` for `:where([data-bb-plugin=`. Details: `bb-plugin-minimap/NOTES.md`.
- `bb-plugin-diff-plus` — a folder tree overlaid into BB's own Diff tab (no BB slot: it finds the tab by markup). Files come from bb--git's `files`/`viewed` via `server.ts`; clicks go through BB's search box; recent commits move the checkout's shared merge base and every exit puts it back. In a split workspace the tab reads its own pane's thread. No utility words anywhere in the folder (dist/app.css must have 0 `:where([data-bb-plugin=` rules). Details: `bb-plugin-diff-plus/NOTES.md`.
- `bb-plugin-lexicon` — colours a project's key terms in replies and prompts with the CSS Custom Highlight API (nothing added to BB's DOM, nothing written to the workspace); a click on a coloured word opens a card saying which term it is. Terms live in plugin kv per project, plus built-in words and names learned from tracked source; each pane has its own lexicon. The backend pushes changes with `bb.realtime.publish` (no polling). `src/lexicon.ts`, `store.ts`, `spans.ts`, `explain.ts` are pure and tested; `paint.ts` repaints only the changed paragraph. The build turns any standalone utility word in the folder (even in tests or docs) into a page-wide rule: split or reword it and grep `dist/app.css` for `:where([data-bb-plugin=`. Details: `bb-plugin-lexicon/NOTES.md`.
- `bb-plugin-guest-view` — shares one thread with someone who has no BB account: a thread action starts a local HTTP server and a Cloudflare quick tunnel; the guest page long-polls (quick tunnels hold SSE back) and suggests prompts that wait on an Owner Card above the composer (Use puts text in the composer; nothing a guest writes reaches the agent by itself). The thread is read as deltas (`src/delta.ts`). The guest page's CSS and script are strings in `src/page.ts`, so the build's utility-word rule applies to them too. Details: `bb-plugin-guest-view/NOTES.md`.

## BB page facts (bb-app 0.47, undocumented, can change)

- Timeline scroller `[data-page-scroll-viewport]`; rows `[data-timeline-row-id]` in DOM order, ids equal the timeline data's row ids. Virtualized at ≥ 20 top-level rows (`[data-timeline-window-spacer]` placeholders); the last row is always mounted.
- Right panel `#thread-detail-secondary-panel` (`data-panel-size` 0 when hidden); on phone width it is `[data-testid=secondary-panel-shelf]`. Every plugin setting write remounts its content.
- The phone drawer (bb-app 0.49) is portaled to `body`, outside `#root`, as `role=dialog aria-modal`: React ignores events on BB elements moved into it. Open it is full width and pinned right (opening animates its width, 296→390px at 390px; it never slides; a swipe moves the page under it), z-index 45 (0 closed, with `inert`); BB's scale puts toasts at 49 and menus at 50. It closes on a thread switch.
- BB's keyboard handler sets `--bb-shell-height` (visual viewport height) and `--bb-safe-area-bottom: 0px` on `body`; the drawer's height is that variable.
- The composer footer `[data-follow-up-composer-footer]` fades out under BB's unlayered container style query on `--follow-up-composer-container-compact` (composer ≤ 30rem wide, or thread pane ≤ 26rem tall; the side panel is not inside the pane's container) until the composer is expanded; collapsed on a phone it is not rendered at all. Plugin CSS is loaded unlayered.
- `experimental_Icon` names are BB's own set, not lucide; a missing name renders the fallback.
