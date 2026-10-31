## What you get

A folder button in the toolbar of BB's Diff tab shows the changed files as a tree beside the file list. Each folder shows how many files changed under it and its added and removed lines, so you can see where a large change lands before you read any of it.

- Click a folder's name to show only the files under it. Click a file to show it alone with its diff open. Click the same row again, or **Changes**, to see everything.
- Click a folder's icon to open or close it; the button beside **Changes** opens or closes them all. Open folders stay pinned at the top while you scroll through them, as in VS Code.
- Files and folders carry vscode-icons glyphs for common languages, tools and folder names, and VS Code's git letters at the right: A added (untracked files too), M modified, D deleted, R renamed. A folder gets a dot: green when everything under it is new, red when it is all deleted, amber otherwise.
- The tree follows the tab's scope (all changes, committed changes, uncommitted changes or a single commit) and its **Filter files** menu (extensions, deleted, viewed). Rows the path filter lets through are tinted. It refreshes when BB reports that the worktree's status or branches changed.
- **Recent commits:** BB's scope picker gets your last 10, 20 or 50 commits, even when they are already merged. Picking one moves the checkout's merge base back for as long as you look at it; any other scope, closing the picker early, or the plugin stopping puts it back.

## Views

The view button beside **Changes** switches between the tree and a flat list, and holds:

- **Compact folders:** a folder holding only one folder shares its row.
- **Synced view:** the tree in the same order as BB's file list. **Scroll sync** keeps the files on screen in the list in view in the tree, and **Visible indicator lines** marks them with a bar.

The folder button holds the rest: the tree on or off, how far folders open at first (All by default, Top or None) and how many recent commits to list.

## Layout

Drag the tree's right edge, or focus it and use the arrow keys, to change its width. In a tab narrower than 600px, such as the phone drawer, the tree goes above the list instead. The options and the width are kept per browser. When you open a file from its card and come back, the tree puts back the folders you had open, the row you picked and where you were in the list.

## How it works

The tree adds to BB's own Diff tab and leaves its diffs alone: filtering goes through the tab's own filter box, so BB's own file search and filters, Viewed checkboxes, split view and "Add to chat" on selected lines all keep working. File paths that look like glob patterns, such as `app/[slug]`, are escaped so a click shows exactly that folder or file.

## Requirements

- BB 0.48 or later.
- BB has no plugin slot beside the Diff tab, so the tree finds the tab by its page structure. A future BB release may move it; the tree then does not show until the plugin is updated.
- It reads the changed files from BB's bundled Git plugin, which the Diff tab itself uses.
- A moved merge base is BB's own setting for the checkout, the one its base branch picker sets: git itself is never changed. Every thread on that checkout sees it while it is moved.
- No external service or account is used.
- The icons are from vscode-icons, under CC BY-SA 4.0: https://github.com/vscode-icons/vscode-icons
