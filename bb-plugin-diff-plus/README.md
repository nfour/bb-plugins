# Diff Plus

Diff Plus improves BB's Diff tab with a folder tree beside the file list, plus a few views that make a large change quicker to find your way around. It adds to the tab: nothing of BB's is replaced, and it doesn't rebuild features BB already has.

![The folder tree in BB's Diff tab beside the chat, the src folder picked: its row highlighted and the list filtered to it](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/diff-plus-tree.png)

![In a narrow panel the tree sits above the file list](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/diff-plus-stacked.png)

![Flat view: every changed file on its own row with its folder beside it, one file picked](https://raw.githubusercontent.com/nfour/bb-plugins/master/docs/screenshots/diff-plus-flat.png)

## Features

- **Folder tree** beside the file list
  - File count and +/- per folder, so you see where a change lands
  - Click a folder or file to show only it; click again, or **Changes**, for everything
  - Click a folder's icon to open or close it; one button opens or closes them all
- **Sticky folders:** open folders stay pinned at the top as you scroll through them
- **File icons and git letters:** A added, M modified, D deleted, R renamed; a coloured dot per folder
- **Tree or Flat view:** folders, or every file on one row with its folder beside it
- **Compact folders:** a folder holding only one folder shares its row
- **Synced view:** the tree in the same order as the file list
  - **Scroll sync:** the tree follows the list as you scroll
  - **Visible indicator lines:** a bar beside the files on screen
- **Recent commits:** your last 10, 20 or 50 commits in the scope picker, even merged ones (see below)
- **Follows the tab:** its scope and its **Filter files** menu; rows the path filter matches are tinted
- **Remembers your place:** open folders, the picked row and your place in the list come back after you open a file
- **Fits any width:** drag the tree's edge to resize it; in a narrow panel or the phone drawer it sits above the list

Every option is configurable, from the folder button in the tab's toolbar and the view button beside **Changes**.

## Works with BB's Diff tab

- Clicks filter through the tab's own filter box
- BB's search, filters, Viewed checkboxes, split view and "Add to chat" work as before
- The folder button in the tab's toolbar turns the tree off

## Recent commits and the merge base

BB's scope picker only lists commits made since the checkout's merge base, so commits that are already merged never show. Diff Plus works around that:

- Picking a recent commit moves the checkout's merge base back far enough for BB to list that commit
- The merge base is BB's own setting for the checkout, the one its base branch picker sets; git itself is never changed
- While it is moved, every thread on that checkout sees it: **All changes**, **Committed** and the branch's git status count those commits too
- It is put back when you pick any other scope, close the picker without picking, or the plugin stops or starts
- Each move and restore is logged (`bb plugin logs diff-plus`)
- Don't want this? Set **Recent commits** to Off in the folder button's menu

## Inspiration

VS Code: the Explorer tree, sticky scroll, compact folders, file icons and git decoration letters.

## Requirements

- BB 0.48 or later
- BB has no plugin slot in the Diff tab yet, so the tree finds it by its page structure; a BB update may need a plugin update

## Maintenance

- Releases follow semver
- Kept up to date with BB releases until BB supports these features natively
- Feature requests and bug reports are welcome: [open an issue](https://github.com/nfour/bb-plugins/issues)

## Install

From the BB plugin marketplace, or from this repository:

```sh
bb plugin install git:https://github.com/nfour/bb-plugins.git@^1.0.0 --plugin diff-plus --tag-prefix diff-plus/
```

Releases are tagged `diff-plus/vX.Y.Z`; see [CHANGELOG.md](CHANGELOG.md).

## Why

The Diff Tree plugin re-rendered its whole file tree on every keystroke in the composer, because the component that drew the tree also read the composer's draft. On a 390-file diff that was ~86ms per key and 26 long frames in 25 keys. BB's own Diff tab on the same diff costs nothing while typing (29ms per key, no long frames), so this plugin builds on it.


## How

- The tree is an app overlay that finds each Diff tab by its markup and portals a toggle into its toolbar and a column into the box around its list (`src/Tree.tsx`, `src/diff-tab.ts`). Its files come from the Git plugin's `files` read, called by `server.ts`, for the scope the tab shows, fetched only while the tree is on and again after a git change. The folder logic and the filter matching are pure and tested (`src/folders.ts`, `src/match.ts`). The menus are Radix dropdowns (`src/TreeMenu.tsx`), the scope picker additions are `src/Picker.tsx`.
- The icons are a subset of [vscode-icons](https://github.com/vscode-icons/vscode-icons) (CC BY-SA 4.0, see `THIRD_PARTY_NOTICES.md`), generated by `pnpm --filter bb-plugin-diff-plus icons` from the vscode-icons extension installed in VS Code: `src/icons.css` has one class per icon with its SVG inlined, `src/icon-map.ts` the file names, extensions and folder names that point to them. `src/file-icons.ts` looks a path up VS Code's way (file name, longest dotted extension, language) and is tested. To add an icon, add its id to the lists at the top of `scripts/icons.mjs` and run the script again.
- Styles are plain prefixed classes in `src/styles.css`, not Tailwind utilities (see the workspace AGENTS.md).

## Develop

```sh
pnpm --filter bb-plugin-diff-plus test    # node --test, no build
pnpm --filter bb-plugin-diff-plus check   # tsc
bb plugin install ./bb-plugin-diff-plus --yes
bb plugin dev ./bb-plugin-diff-plus
```

## Credits

File icons from [vscode-icons](https://github.com/vscode-icons/vscode-icons), CC BY-SA 4.0 (see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). The rest is MIT.
