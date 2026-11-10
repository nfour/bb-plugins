# Minimap

A scrollbar replacement for BB threads. A strip along the right edge that you scrub like a scrollbar, drawn like VS Code's minimap: crude rectangles in place of the messages, and a slider over the part you are reading.

## What you get

- **One rectangle per row of the timeline**, as tall as the row (to scale), in its own colour: your messages (light grey, right-aligned and as wide as the message is, like the bubble), agent replies (grey, full width), work (amber: "Worked for 2m" rows and the tool rows of a turn still in progress), errors (red) and system notes (faint).
- **A slider** shows what is on screen. Drag it to scrub the thread; click anywhere to jump there; scroll the wheel over the strip to scroll the thread.
- It is there on every thread, except a short one with nothing to scroll (**Hide when the thread fits**, on by default; switch it off to keep the strip there). Going back to a thread you have seen starts from the row sizes the strip learned, so it settles at once.
- On a very long thread your messages and errors stay marked: they are drawn over the replies, and never thinner than two device pixels.
- Hover a rectangle and a note beside the strip names it, with the start of its message (**Preview on hover**, on by default).
- It replaces the scrollbar. BB's own scrollbar fades out and is hard to grab, so it is switched off while the Minimap shows. Keep both if you like, and **Always show the scrollbar** stops BB fading its own out, so it works as a second position indicator.
- When it shows, the strip spans the full height, even for a short thread. Nothing is read while the strip is not shown (a narrow window) or the tab is in the background, and a refresh while a turn works reads only what changed. It reads the newest page of the thread by default, and reads older pages only as BB loads them while you scroll up, so the strip has blocks for everything the scrollbar covers (the blocks get smaller as the thread grows, as the scrollbar thumb does). Turn on **Load the whole history** to fetch older pages in the background, which takes a while and costs more on a long thread.

## Settings

**Minimap** in a thread's actions menu (the three dots in the thread header, or a sidebar row's menu) opens a settings panel that floats over the chat at its top left, so you can watch the strip change as you edit. Drag it by its title bar; Esc or × closes it; **Reset all** (asks twice) puts every setting back to its default. It has four tabs, each option with a one-line description: **Behaviour** (showing the strip, **Hide the thread-index button**, **Preview on hover**, **Hide when the thread fits**, which takes the strip away while there is nothing to scroll, as the scrollbar goes, and **Load the whole history**), **Strip** (**Replace the scrollbar**, **Always show the scrollbar**, width 6 to 120px, opacity, **Fade when not hovered** with its idle opacity, and **Keep on narrow windows** with its own **Narrow width**, 4 to 60px, for when the window is too narrow for the strip: by default it hands back to the scrollbar), **Blocks** (a colour and a show switch for your messages, agent replies, work, errors and system notes; **Theme** resets a colour) and **Slider**, which styles the viewport slider (show it, round or square corners, thickness 1 to 6px, opacity and colour). Nothing changes on hover unless fading is on, and then it animates. You can hide the menu entry on the plugin's page in BB's settings.

## Where it shows

It hugs the right edge of the thread, where the scrollbar was. BB's thread-index button (the small picker near the scrollbar) is moved just left of it, or removed with **Hide the thread-index button**. It needs a window wide enough to leave room: about 920px of thread width for the column, the strip and BB's thread-index button. On a narrower window (a phone) it is left out and BB's own scrollbar stays.

## Requirements

- BB 0.49 or later.
- It reads BB's timeline layout, which is not a documented interface, so a future BB release may need a plugin update.
- No external service or account is used; the only thing it fetches is the thread's own timeline, the same pages BB reads.
