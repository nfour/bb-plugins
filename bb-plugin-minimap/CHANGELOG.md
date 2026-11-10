# Changelog

Releases are the tags `minimap/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.0 (2026-11-11)

- First release. A strip along the right edge of each thread that stands in for the scrollbar: one rectangle per message, as tall as the message and coloured by kind (your messages, replies, work, errors, system notes), with a slider over what is on screen. Drag the slider to scrub, click to jump, or scroll the wheel over the strip.
- Your messages are right-aligned and as wide as their bubble, and they and errors stay visible on a very long thread. Hovering a rectangle names it with the start of its message.
- BB's scrollbar is switched off while the strip shows (or kept, and kept from fading), and BB's thread-index button moves to the left of the strip or is hidden. On a narrow window the strip narrows or hands back to the scrollbar, and it goes away on a thread with nothing to scroll.
- **Minimap** in a thread's actions menu opens a floating settings panel with four tabs (Behaviour, Strip, Blocks, Slider). Changes show on the strip as you drag.
- Light on the thread: while a turn works it reads only what changed, and it reads nothing while the strip is hidden or the tab is in the background. Older pages load as BB loads them, or all at once with **Load the whole history**.
