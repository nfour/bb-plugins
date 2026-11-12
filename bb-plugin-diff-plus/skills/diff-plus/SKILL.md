---
name: diff-plus
description: Explain or debug the Diff Plus plugin, which adds a folder tree beside the file list in BB's Diff tab. Use when the user asks why the tree is or is not showing, how to turn it off, or when its files look wrong.
---

# Diff Plus

Adds to BB's own Diff tab, without replacing its diffs or file list:

- **Folder tree**: the folder button in the Diff tab's toolbar shows a tree of the changed files beside the list, with file counts and +/- per folder. Clicking a folder's icon opens or closes it (there are no chevrons); clicking its name types `folder/**` into BB's own search box; clicking a file types its path and opens its card (as `<path>/**` when another changed file's path contains it, since BB matches a plain query anywhere in a path; glob characters such as `app/[slug]` or `app/(marketing)` are escaped); clicking the selected row again, or "All files", clears the search. Rows look like VS Code's explorer: vscode-icons file and folder glyphs (a subset: the common languages and tools; anything else gets the plain file or folder glyph), and at the right end the git letter (U untracked, A added, M modified, D deleted, R renamed, C copied, T type changed) or, on a folder, a dot: green when everything under it is new, red when it is all deleted, amber otherwise. Drag the tree's right edge (or focus it and use the arrow keys) to change its width. When the tab is narrower than 600px (a narrow window, the phone drawer) the tree goes above the list instead, at 38% of its height, and its edge does not drag. On/off (on by default) and the width are kept per browser (localStorage `bb-plugin-diff-plus:tree`, `bb-plugin-diff-plus:tree-width`).

Quoting selected lines is BB's own: the "+" beside a line (drag it over several) or a click on one line number and a Shift-click on another opens BB's "Add to chat", which puts the lines in the draft as a quoted mini patch. Diff Plus adds nothing to the diffs.

There are no plugin settings. To go back to BB's plain diffs, disable the plugin: `bb plugin disable diff-plus`.

## When it does not show

- **The tree**: BB has no slot beside the Diff tab, so the tree finds the tab by its markup (bb-app 0.47.1: `[data-testid=git-diff-toolbar-layout]`, `-selector-slot`, `-actions`, and the query input labelled "Filter changed files by path"). A BB update that changes these makes the tree and its toolbar button disappear quietly.
- **"No folder tree for this view"**: the scope picker shows a label the tree does not know. It reads "All changes", "Committed changes", "Uncommitted changes" and "<sha> <subject>".

## Where the files come from

The tree asks BB's Git plugin (`bb--git` `files`, through the plugin's backend) for the scope the tab shows (the environment's merge base branch, or its default branch, for "All changes" and "Committed changes"), only while a tree is on, and again a second after the environment reports a git change. A failed fetch is retried every 3 seconds.
