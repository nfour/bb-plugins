# Changelog

Releases are the tags `diff-plus/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 1.2.0 (2026-11-12)

- The tree works from the keyboard: it is one Tab stop; Up and Down move, Home and End go to the ends, Right opens a folder, Left closes it or goes to its parent, and Enter picks.
- In a split workspace, a pane's Diff tab no longer shows the focused pane's files while its own thread loads.
- Lighter on every page: the file icons' styles load only once a Diff tab is open, the plugin adds no page-wide style rules, and the merge base is put back only when Diff Plus moved it.
- Nothing is checked while the browser tab is in the background.

## 1.1.1 (2026-11-10)

- Typing in the composer no longer runs any of Diff Plus's code: it only listens for typing in the Diff tab's own search box.

## 1.1.0 (2026-11-02)

- Works in a split workspace: each pane's Diff tab shows the tree for that pane's own thread. Before, the tree in a right-hand pane could list the left pane's files while BB's cards showed the right pane's.
- The tree's column loads in one go: **Changes** shows straight away with a spinner under it, instead of a "Loading files…" line followed by an empty gap. The messages for an error or no changes sit under **Changes** too.

## 1.0.0 (2026-10-31)

- First stable release, with no change in behaviour from 0.1.2. From here, new features come as 1.x minor releases and fixes as patches, and both reach marketplace installs on their own.
- The marketplace listing is rewritten as a plain list of features, with three screenshots.

## 0.1.2 (2026-10-31)

- The folder button opens a menu: the tree on or off, how far folders open at first, and recent commits.
- A view menu beside **Changes** switches between the tree and a flat list, and holds Compact folders and Synced view (the tree in the list's order, with optional scroll sync and indicator lines).
- Recent commits: the last 10, 20 or 50 commits show in the scope picker, even when they are already merged. Picking one moves the merge base back while you look at it, and anything else puts it back.
- The tree follows the Diff tab's Filter files menu (extensions, deleted, viewed), and tints the rows the path search shows.
- Open folders stay pinned at the top while you scroll through them.
- Coming back to the Diff tab after opening a file puts back your open folders, the picked row and your place in the list.
- Untracked files show A, like added ones.
- Folders open fully at first by default (All); Top and None are in the folder button's menu.
- The view switch reads Tree / Flat.
- With Scroll sync, the tree lands on a whole row when it follows the list, so no row hides half under the pinned folders.
- The soft edge under pinned folders no longer leaves stale paint behind in Brave.

## 0.1.1 (2026-10-29)

- Requires BB 0.48 or later.
- The changed files are read from BB's bundled Git plugin, since BB 0.48 retired the call the tree used before.

## 0.1.0 (2026-10-29)

- First release.
