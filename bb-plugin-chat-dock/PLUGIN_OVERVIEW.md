## What you get

Open a thread's right panel and the composer moves into it: the message box, the cards above it (running commands, child threads, questions) and the chips under it. The timeline keeps the full width of its column, and you can read a diff, a file or a browser tab in the panel while you write about it.

Nothing is rebuilt. BB's own composer is moved as it is, so a half-written draft, an open picker and the other plugins' parts of the composer come along, and they go back to the column when the panel closes.

## Behavior

- It docks as a strip at the panel's bottom, under whichever tab is open, or as a Chat tab of its own; the dock button, the thread menu and two palette commands choose.
- Switching between the two moves the composer once, straight to its new place, and the dock button never expands the box.
- Hiding the right panel (Ctrl+J) puts the composer back under the timeline.
- Opening another thread with the panel open docks that thread's composer.
- In a split workspace the panel belongs to the focused pane, and that pane's composer docks into it; the other panes' composers stay under their timelines.
- On a phone-width screen the composer docks at the bottom of the panel drawer and works as it does under the timeline: tap it to expand it and see its footer, and it stays above the on-screen keyboard. The dock button shows while the box is expanded; the thread menu has every option.
- In the side panel the composer's footer (environment, permission mode, context meter) stays shown even when the panel is narrow.

## Requirements

- BB 0.48 or later.
- It moves BB's own page elements, which are not a documented interface, so a future BB release may need a plugin update.
- No external service or account is used.
