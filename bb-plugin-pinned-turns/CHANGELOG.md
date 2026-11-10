# Changelog

Releases are the tags `pinned-turns/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.4 (2026-11-11)

- Lighter on BB's styling: the plugin no longer adds page-wide CSS rules. Earlier releases added nine, made from ordinary words in its own code and docs, which BB matched against every element on the page whenever it restyled. Nothing changes in how the bar looks or works.

## 0.1.3 (2026-11-11)

- Much lighter on a working thread. While a turn works, the bar fetches only what changed in the timeline, usually about 1 KB, instead of the whole newest page (70 to 80 KB) each time. It still fetches the whole page now and then, at most once a minute.
- Nothing is fetched while the bar is off the page or the tab is in the background. It catches up once when you come back. The turn counter follows the same rule.

## 0.1.2 (2026-10-29)

- Requires BB 0.48 or later.
- Clicking the latest message from the bottom of a thread jumps to it again. BB 0.48's scroll keeper pulled the jump back to the bottom halfway.
- The options moved from the header button, which BB 0.48 retired, to a **Pinned turns** submenu in the thread's actions menu.

## 0.1.1 (2026-10-29)

- Light theme: the reply half is now lighter than the message half, as in the dark theme. It was the other way round.

## 0.1.0 (2026-10-29)

- First release.
