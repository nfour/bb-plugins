# Changelog

Releases are the tags `diff-plus/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.2 (2026-10-30)

- The folder button opens a menu: the tree on or off, how far folders open at first, and recent commits.
- A view menu beside **Changes** switches between the tree and a flat list, and holds Compact folders and Synced view (the tree in the list's order, with optional scroll sync and indicator lines).
- Recent commits: the last 10, 20 or 50 commits show in the scope picker, even when they are already merged. Picking one moves the merge base back while you look at it, and anything else puts it back.
- The tree follows the Diff tab's Filter files menu (extensions, deleted, viewed), and tints the rows the path filter shows.
- Open folders stay pinned at the top while you scroll through them.
- Coming back to the Diff tab after opening a file puts back your open folders, the picked row and your place in the list.
- Untracked files show A, like added ones.

## 0.1.1 (2026-10-29)

- Requires BB 0.48 or later.
- The changed files are read from BB's bundled Git plugin, since BB 0.48 retired the call the tree used before.

## 0.1.0 (2026-10-29)

- First release.
