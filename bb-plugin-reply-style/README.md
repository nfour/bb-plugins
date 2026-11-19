# Reply Style

A BB plugin that styles the reply surface of a thread: quotes, spoilers (`<details>`), tables in spoilers and nested lists, in the agent's replies and in your own messages. It carries the rules the `reply-style` format assumes, so they no longer live in a pasted theme.

## What changes on screen

- Quote bars are a neutral grey instead of the theme's accent, and quoted text is a little lighter than body text.
- A spoiler's summary line: the description after the chips is dimmed and slanted, the whole line lights up under the pointer, and a chevron replaces the triangle, turning as the spoiler opens.
- Spoilers open and close smoothly, without cutting off wide tables that span past the message. With reduced motion set in your system, they open at once.
- Wide tables keep their full-width span and sit on the message's surface, so guide lines and quote bars pass under them instead of through.
- **Guide Lines:** a thin line down every list of two or more items and each nesting level in it, so the spoiler, quote or sub-list under an item reads as belonging to it. It serves both of the format's shapes: checked items with evidence under them, and numbered questions with their options.
- **Elbows:** the line runs from bullet to bullet, each nested item, spoiler and quote joins it with a short stub, and under the last item it stops at the last stub, like a file tree.
- Checkboxes in replies sit on the middle of their text line instead of a little high.
- **Dim Markers:** bullets and numbers are dimmed (marker strength, 45%), so the text leads.
- **Path Numbers** (off): options under a numbered question show their path, `1.1`, `1.2`, `2.1`, the key an answer uses.
- **Spoiler As Quote:** an opened spoiler gets a quote bar down its side and quote-coloured text, so its body is written as plain markdown.

Every colour is mixed from the theme's ink and canvas, so it follows any theme, light or dark.

## Settings

**Reply Style** in a thread's actions menu opens a settings panel over the chat, like Minimap's: drag it by its title bar, Esc closes it. The same panel is the plugin's page in BB's settings. Sliders restyle the replies behind the panel while you drag and save when you let go; **Reset all** puts every value back.

- **Quotes:** bar strength, bar width, text strength.
- **Spoilers:** **Spoiler As Quote**, **Spoiler Card** (off) with its edge line and shade strengths, description strength, hover surface, chevron strength, open and close time (0 snaps).
- **Lists:** **Guide Lines** (on), **Elbows** (on), **Path Numbers** (off), **Dim Markers** (on), line strength, line width, marker strength (45%), checkbox drop (2.5px).
- **Tables:** **Tables Surface** (on), the background that lets lines pass under tables; **Fit Spoilers** (off), which keeps wide tables inside a spoiler to the spoiler's width, scrolling sideways.

A switch's own settings sit indented under it in the panel and grey out while it is off (Guide Lines holds Elbows and the line's strength and width; Dim Markers holds Marker strength; Spoiler Card holds its two strengths).

An opened spoiler's summary line stays in view at the top of the timeline while you scroll through its body.

**Height Limit** (off) caps an opened spoiler's body at a height and scrolls it inside; **Screen Height Units** (on) picks between a share of the window's height and a number of pixels, each with its own slider (the one not in use is greyed out).

**Spoiler Card** (off) puts an opened spoiler, summary line included, in a box with a thin edge line and a soft shade, in place of the quote bar. Closed, the box is invisible; it fades in as the spoiler opens.

**Spoiler As Quote** (on) draws the quote bar on the opened part of every spoiler and gives its text the quote colour, so the reply format writes spoiler bodies without `>`. A real quote inside a spoiler keeps its own bar; replies written before the format changed quoted their bodies and show two bars.

## Where it applies

Only inside a thread's timeline. The composer, Docs, the Diff tab, flare bodies and other plugins' views are untouched. Guest View renders replies with its own parser and is not covered.

## Install

```sh
bb plugin install ./bb-plugin-reply-style --yes
```
