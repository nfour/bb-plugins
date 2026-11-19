# Reply Style

A BB plugin that styles the reply surface of a thread: quotes, spoilers (`<details>`), tables in spoilers and nested lists, in the agent's replies and in your own messages. It carries the rules the `reply-style` format assumes, so they no longer live in a pasted theme.

## What changes on screen

- Quote bars are a neutral grey instead of the theme's accent, and quoted text is a little lighter than body text.
- A spoiler's summary line: the description after the chips is dimmed and slanted, the whole line lights up under the pointer, and a chevron replaces the triangle, turning as the spoiler opens.
- Spoilers open and close smoothly, without cutting off wide tables that span past the message. With reduced motion set in your system, they open at once.
- Wide tables keep their full-width span and sit on the message's surface, so guide lines and quote bars pass under them instead of through.
- **Guide Lines:** a thin line down each nesting level of a list, so the spoiler, quote or sub-list under an item reads as belonging to it. It serves both of the format's shapes: checked items with evidence under them, and numbered questions with their options.
- **Elbows:** the line runs from bullet to bullet, each nested item, spoiler and quote joins it with a short stub, and under the last item it stops at the last stub, like a file tree.
- Checkboxes in replies sit on the middle of their text line instead of a little high.

Every colour is mixed from the theme's ink and canvas, so it follows any theme, light or dark.

## Settings

**Reply Style** in a thread's actions menu opens a settings panel over the chat, like Minimap's: drag it by its title bar, Esc closes it. The same panel is the plugin's page in BB's settings. Sliders restyle the replies behind the panel while you drag and save when you let go; **Reset all** puts every value back.

- **Quotes:** bar strength, bar width, text strength.
- **Spoilers:** **Spoiler As Quote**, description strength, hover surface, chevron strength, open and close time (0 snaps).
- **Lists:** **Guide Lines** (on), **Elbows** (on), line strength, line width, checkbox drop (2.5px).
- **Tables:** **Tables Surface** (on), the background that lets lines pass under tables.

**Spoiler As Quote** (off) draws the quote bar on the opened part of every spoiler, so a spoiler's body needs no `>` on each line. A quote sitting right inside a spoiler loses its own bar, so older replies do not show two. Turn it on together with a change to the format that stops quoting spoiler bodies.

## Where it applies

Only inside a thread's timeline. The composer, Docs, the Diff tab, flare bodies and other plugins' views are untouched. Guest View renders replies with its own parser and is not covered.

## Install

```sh
bb plugin install ./bb-plugin-reply-style --yes
```
