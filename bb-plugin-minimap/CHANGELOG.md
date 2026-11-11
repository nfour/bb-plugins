# Changelog

Releases are the tags `minimap/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.4 (2026-11-11)

- The hover note shows the rows around the pointer, not just one: the pointer's row bright and one row above and below it dimmed. Moving along the strip glides the list to the next row. **Context rows**, **Text lines**, **Hover delay** (now 66ms by default), and the glide's time and softness are settings on the new Note tab.
- Each row in the note has an icon in its rectangle's colour, and the note stays while you press or drag on the strip.
- A soft shade falls from the strip's edge over the thread on a dark theme, with settings for its strength, reach, colour, layer and where it starts.
- Clicks and the wheel glide. A click on a part of a long thread that was not loaded yet now lands where you clicked; before, it stopped about a tenth of the way. The wheel over the strip goes three times as far as the thread's own by default (**Wheel speed**), and its glide always comes to an end; before, it could keep nudging the thread about a pixel short of its target.
- A slight wobble while clicking no longer turns a click into a jump.
- The settings panel has six tabs (Behaviour, Strip, Scrolling, Blocks, Slider, Note), with groups inside Strip and Note, works from the keyboard, and opens as a sheet from the bottom on a phone. The same panel is now the Minimap section of the plugin's page in BB's settings.
- **Always show the scrollbar** is on by default; it matters only when **Replace the scrollbar** is off.

## 0.1.3 (2026-11-11)

- The hover note shows a small icon for what the row is (you, the agent, a command, a file read, a search and so on) in place of "You:" and "Agent:", and a row of work shows what ran or was read, such as the command. A finished turn shows how many steps it took.
- The note keeps one width (320px, at most 70% of the window) and cuts long text with an ellipsis, so its size no longer jumps from row to row.
- Moving along the strip is smooth: the note no longer makes the page redo its layout each time its text changes, and it switches rows at most every 100ms.

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
