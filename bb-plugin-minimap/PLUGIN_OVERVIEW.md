## What you get

Minimap is a scrollbar you can read. It puts a strip along the right edge of each thread, drawn like VS Code's minimap: one rectangle per message, as tall as the message, coloured by who wrote it. A slider marks the part you are reading.

- Drag the slider to scrub through the thread, click anywhere on the strip to go there, or scroll the wheel over it.
- Your messages are light grey and right-aligned, as wide as the bubble. Agent replies are grey, work is amber, errors are red and system notes are faint, so a long thread shows where you asked something, where the agent worked for a while and where something failed.
- The strip is drawn to scale, so its slider sits where the scrollbar's thumb would. On a very long thread your messages and errors are painted on top and stay at least two device pixels tall.

## The hover note

Hover the strip and a note beside it names the rows around the pointer: the pointer's own row bright, one row above and below it dimmed. Each row has an icon in its rectangle's colour (you, the agent, a command, a file read, a search, a finished turn) and the start of its text, such as the command that ran or a turn's step count. Moving along the strip glides the list to the next row, softening a little when it passes many rows, and the note's arrow points at the rectangle, which gets a thin line in its own colour. The note stays while you press and drag, so it keeps naming the rows as you scrub.

How many rows of context it shows (0 to 6), how many lines of each message (1 to 6), the glide's time and softness, and the least time between rows are all settings.

## Scrolling

A click on the strip glides to the place you clicked, even in a part of a long thread BB has not loaded yet, and lands where you aimed. The wheel over the strip glides too, with quick steps adding up, and goes three times as far as the thread's own wheel (**Wheel speed**, 25 to 1000%). Either can jump instead.

## The scrollbar and the shade

BB's scrollbar fades out and is thin to grab, so Minimap switches it off while the strip is there. Turn off **Replace the scrollbar** to keep both; **Always show the scrollbar** then stops BB fading it. BB's thread-index button is removed while the strip is there; turn **Hide the thread-index button** off and it sits just left of the strip. A thread with nothing to scroll gets no strip.

On a dark theme a soft shade falls from the strip's edge over the thread. Its strength and reach are sliders, and it can sit over or under the rectangles, start from the strip's edge or the window's, and darken with black or fade into the theme's background. It is off on a light theme unless you turn **No shade on a light theme** off.

## Settings

Pick **Minimap** in a thread's actions menu. A settings panel opens over the chat, so you can watch the strip change as you edit. It has six tabs, and the same panel is the Minimap section of the plugin's page in BB's settings:

- **Behaviour**: showing the strip, the thread-index button, short threads, and loading the whole history.
- **Strip**: size, fading when the pointer is elsewhere, the scrollbar, and the shade.
- **Scrolling**: whether a click and the wheel glide or jump, and the wheel's speed.
- **Blocks**: a colour and an on/off switch for each kind of rectangle.
- **Slider**: the slider's corners, thickness, opacity and colour.
- **Note**: the hover note and its glide.

Sliders and colours preview on the strip as you drag. The tabs work from the keyboard. On a phone the panel opens as a sheet from the bottom. **Reset all** asks twice before it puts everything back.

## Narrow windows

The full strip needs about 920px of thread width. On a narrower window it drops to a narrow width (12px by default) and may overlap the edge of the message column; turn off **Keep on narrow windows** to get BB's scrollbar back there instead.

## Requirements and costs

- BB 0.49 or later.
- It reads the thread's timeline through BB's plugin SDK: the newest page first, older pages only as BB loads them, and only what changed while a turn is working. It reads nothing while the strip is not shown or the tab is in the background. **Load the whole history** fetches every older page up front and is off by default.
- No external service or account is used.
- It relies on BB's timeline layout, which is not a documented interface, so a future BB release may need a plugin update.
