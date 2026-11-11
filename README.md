# BB plugins

Plugins for [BB](https://getbb.app), one folder each.

| Plugin | What it does |
| --- | --- |
| [Pinned Turns](bb-plugin-pinned-turns) | Keeps the message you are reading under and the latest agent reply pinned to the top of a thread; click either to jump to it. |
| [Chat Dock](bb-plugin-chat-dock) | Moves the composer into the thread's right panel while it is open, as a strip under any tab or as a Chat tab. |
| [Diff Plus](bb-plugin-diff-plus) | Improves BB's Diff tab with a folder tree, sticky folders, Tree or Flat view, a view synced with the list, and recent commits in the scope picker. |
| [Lexicon](bb-plugin-lexicon) | Colours a project's key terms in chat, the same way every time: plugin names, features, code identifiers, actions and outcomes. |
| [Guest View](bb-plugin-guest-view) | Shares one thread with someone who has no BB account through a public link: they follow it live and suggest prompts you approve. |
| [Performance](bb-plugin-performance) | A nav tab measuring how far BB is from feeling native in your real sessions (frames, typing, thread switches, start, idle, memory) and which plugin is behind a slowdown. |
| [Minimap](bb-plugin-minimap) | A scrollbar replacement: a strip along the edge of each thread, one rectangle per row sized and coloured by kind, with a slider you drag to scrub. |
| [Stay at bottom](bb-plugin-stay-at-bottom) | Keeps a streaming thread scrolled to its bottom when BB's own keeper slips. |

## Screenshots

**Pinned Turns**

![The bar pinned at the top of a long thread, naming the reply and the question, with the turn counter](docs/screenshots/pinned-turns-bar.png)

![The Pinned turns submenu in the thread's actions menu](docs/screenshots/pinned-turns-menu.png)

**Minimap**

![A thread in the dark theme with the minimap along its right edge: rectangles for replies, your messages and work, with the slider over the part on screen](docs/screenshots/minimap-dark.jpg)

![The same thread in the light theme](docs/screenshots/minimap-light.jpg)

![Hovering the strip: the note shows the pointer's row and its neighbours, each with an icon](docs/screenshots/minimap-hover.jpg)

![The shade beside the strip, at full strength](docs/screenshots/minimap-shade.jpg)

![The settings panel on the Note tab](docs/screenshots/minimap-settings-note.jpg)

![The Strip tab's Shade group](docs/screenshots/minimap-settings-shade.jpg)

**Chat Dock**

![The composer docked at the bottom of the right panel, under the Info tab](docs/screenshots/chat-dock-strip.png)

![The Chat dock submenu in the thread's actions menu](docs/screenshots/chat-dock-menu.png)

**Diff Plus**

![The folder tree in BB's Diff tab beside the chat, the src folder picked: its row highlighted and the list filtered to it](docs/screenshots/diff-plus-tree.png)

![In a narrow panel the tree sits above the file list](docs/screenshots/diff-plus-stacked.png)

![Flat view: every changed file on its own row with its folder beside it, one file picked](docs/screenshots/diff-plus-flat.png)

**Guest View**

![What a guest sees: the conversation, a Working line, the prompts they sent and a composer with their name](docs/screenshots/guest-view-page-light.jpg)

![The same page in the dark theme, with the list of sent prompts open](docs/screenshots/guest-view-page-dark.jpg)

![Share with guest in the thread's actions menu](docs/screenshots/guest-view-menu.jpg)

![The card above the composer, opened: guests connected, how long the link has lived, and waiting prompts with Use, Copy and Dismiss](docs/screenshots/guest-view-owner-card.jpg)

![The card with its History opened](docs/screenshots/guest-view-owner-card-history.jpg)

![The settings panel: who is connected with a Kick button, the link's expiry and what guests see](docs/screenshots/guest-view-settings.jpg)

**Performance**

![The Performance tab in BB's nav: the score, the nine metrics against their targets, and the first charts](docs/screenshots/performance-dashboard-light.png)

![The same tab in the dark theme](docs/screenshots/performance-dashboard-dark.png)

![Distributions, slow moments over time, and the plugins as charts](docs/screenshots/performance-charts.png)

![Slow moments with the split of each frame, marks you made, and where the time of slow frames went](docs/screenshots/performance-moments.png)

![The plugin list with one row opened: what that plugin costs, its trend, what started its script and the class names behind its page-wide CSS](docs/screenshots/performance-plugins.png)

![The thread-switch benchmark run with plugin CSS on and off: the second row of bars is the run without it](docs/screenshots/performance-compare.png)

![Where the time of slow frames went, what started BB's own script, and the places in the bundle that forced layout](docs/screenshots/performance-forced-layout.png)

## Install

From the BB plugin marketplace, or from this repository (each plugin is tagged `<id>/vX.Y.Z`):

```sh
bb plugin install git:https://github.com/nfour/bb-plugins.git@^0.1.0 --plugin pinned-turns --tag-prefix pinned-turns/
```

## Develop

A pnpm workspace. See [AGENTS.md](AGENTS.md) for how each plugin works and the BB page structure it relies on.

```sh
pnpm install
pnpm check                              # tsc in every plugin
pnpm build                              # bb plugin build in every plugin
bb plugin install ./bb-plugin-<id> --yes
bb plugin dev ./bb-plugin-<id>          # rebuild and reload on save
```

## License

MIT, except the vscode-icons glyphs in Diff Plus (CC BY-SA 4.0, see [its notices](bb-plugin-diff-plus/THIRD_PARTY_NOTICES.md)).
