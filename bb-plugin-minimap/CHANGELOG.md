# Changelog

Releases are the tags `minimap/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.2 (2026-11-11)

- The hover note is smoother. One note follows the pointer and slides from row to row, with no flicker in the gaps between rectangles, and an arrow on its right points at the rectangle it names. The hovered rectangle gets a thin line inside it in its own colour.
- New defaults: BB's thread-index button is now removed while the strip shows, and the narrow width is 12px (was 14px), which suits a phone better. A value you saved stays; **Reset all** uses the new ones.

## 0.1.1 (2026-11-11)

- Lighter on BB's styling: 0.1.0 added two page-wide CSS rules, made from words in its own changelog, that BB matched against every element on the page. They are gone.
- New README and marketplace overview, with screenshots of the hover note and the settings panel.

## 0.1.0 (2026-11-11)

- First release. A strip along the right edge of each thread that stands in for the scrollbar: one rectangle per message, as tall as the message and coloured by kind (your messages, replies, work, errors, system notes), with a slider over what is on screen. Drag the slider to scrub, click to jump, or scroll the wheel over the strip.
- Your messages are right-aligned and as wide as their bubble, and they and errors stay easy to spot on a very long thread. Hovering a rectangle names it with the start of its message.
- BB's scrollbar is switched off while the strip shows (or kept, and kept from fading), and BB's thread-index button moves to the left of the strip or is removed. On a narrow window the strip narrows or hands back to the scrollbar, and it goes away on a thread with nothing to scroll.
- **Minimap** in a thread's actions menu opens a floating settings panel with four tabs (Behaviour, Strip, Blocks, Slider). Changes show on the strip as you drag.
- Light on the thread: while a turn works it reads only what changed, and it reads nothing while the strip is not shown or the tab is in the background. Older pages load as BB loads them, or all at once with **Load the whole history**.
