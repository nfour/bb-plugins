A scrollbar replacement for BB threads: a strip along the edge that you scrub like a scrollbar, drawn like VS Code's minimap.

## What you get

- A rectangle for every row of the thread, as tall as the row, so a long chat becomes a picture of its shape: your messages in light grey (right-aligned, as wide as the message), agent replies in grey, work in amber, errors in red.
- A slider over what is on screen. Drag it to scrub through the thread, click anywhere to jump there, or scroll the wheel over the strip.
- It replaces BB's thin scrollbar, which fades out and is hard to grab. Keep both if you like, with the scrollbar set to stay shown so it acts as a second position indicator.

## Settings

A **Minimap** entry in each thread's actions menu opens a settings panel that floats over the chat, at its top left, draggable by its title bar. Four tabs, each option with a one-line description: Behaviour (showing the strip, hiding BB's thread-index button, loading the whole history), Strip (replacing the scrollbar, keeping it shown, width 6 to 120px, opacity, fading when not hovered with its idle opacity, keeping the strip on narrow windows at its own width), Blocks (a colour and a show switch for each kind of rectangle) and Slider (the viewport slider's corners, thickness, opacity and colour). Changes show on the strip as you make them.

## Requirements

- BB 0.49 or later. It needs a window wide enough to leave room beside the message column, so it is left out on a phone.
- It reads BB's timeline layout, which is not a documented interface, so a future BB release may need a plugin update.
