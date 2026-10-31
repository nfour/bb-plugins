# BB plugins

Plugins for [BB](https://getbb.app), one folder each.

| Plugin | What it does |
| --- | --- |
| [Pinned Turns](bb-plugin-pinned-turns) | Keeps the message you are reading under and the latest agent reply pinned to the top of a thread; click either to jump to it. |
| [Chat Dock](bb-plugin-chat-dock) | Moves the composer into the thread's right panel while it is open, as a strip under any tab or as a Chat tab. |
| [Diff Plus](bb-plugin-diff-plus) | Improves BB's Diff tab with a folder tree, sticky folders, Tree or Flat view, a view synced with the list, and recent commits in the scope picker. |
| [Stay at bottom](bb-plugin-stay-at-bottom) | Keeps a streaming thread scrolled to its bottom when BB's own keeper slips. |

## Screenshots

**Pinned Turns**

![The bar pinned at the top of a long thread, naming the reply and the question, with the turn counter](docs/screenshots/pinned-turns-bar.png)

![The Pinned turns submenu in the thread's actions menu](docs/screenshots/pinned-turns-menu.png)

**Chat Dock**

![The composer docked at the bottom of the right panel, under the Info tab](docs/screenshots/chat-dock-strip.png)

![The Chat dock submenu in the thread's actions menu](docs/screenshots/chat-dock-menu.png)

**Diff Plus**

![The folder tree in BB's Diff tab beside the chat, the src folder picked: its row highlighted and the list filtered to it](docs/screenshots/diff-plus-tree.png)

![In a narrow panel the tree sits above the file list](docs/screenshots/diff-plus-stacked.png)

![Flat view: every changed file on its own row with its folder beside it, one file picked](docs/screenshots/diff-plus-flat.png)

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
