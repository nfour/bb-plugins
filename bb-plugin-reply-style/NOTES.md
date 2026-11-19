# Reply Style: notes for agents

What an agent working on this plugin must know. The user-facing description is `README.md`. BB facts below were checked on bb-app 0.49.0 in a headless page and are undocumented.

## The format this styles

Since 2026-11-18 this plugin's thread (`thr_ig7mwdgfv8`) owns the `reply-style` format as well as its CSS, because the two change together. The format lives in `/home/dev/.agents/skills/reply-style/` (git repo `~/.agents`, one commit per change, with the reason): `core.md` (the always-on rules, applied with `bb instructions set`), `SKILL.md`, `example.md`, and `styling.css`, now only a pointer to `src/styles.css`. Read `HANDOVER.md` there before changing any of it: it holds the settled decisions, the 4,096 cap (counted as a JavaScript string length) and BB's renderer facts. The rules used to be pasted into the user's theme `~/.bb/theme/null-syntax/theme.css`; that copy is gone and must not come back.

Next, when the user asks: turn Spoiler As Quote on by default and drop the `>` prefix from spoiler bodies in `core.md`, `SKILL.md` and `example.md`, all in the same change.

Constraints from the request, held by `src/styles.test.ts`:

- Element names and data attributes only, never a BB class name.
- Every colour is `color-mix(in oklch, var(--ink) N%, var(--canvas))`.
- The open animation clips with `clip-path: inset(0 -100vw 0 -100vw)`, never `overflow: clip`, which cut off wide tables. Keep the comment saying why.
- No `!important`, no rule on `:root` except the option switches.

## How the stylesheet gets on the page

- `bb plugin build` leaves plain element selectors as written (it only scopes the utility words it finds) and flattens native nesting. Plugin CSS is unlayered and BB's classes sit in `@layer utilities`, so the plugin wins without `!important`.
- BB keeps a plugin's `app.css` on the page only while one of its slots is mounted or a content script is registered. `app.tsx` registers an empty content script for that.
- The comments in `src/styles.css` are not scanned for utility words; this file, `README.md`, `PLUGIN_OVERVIEW.md` and every `.ts`/`.tsx` file are. `src/styles.test.ts` fails if `dist/app.css` has any `:where([data-bb-plugin=` rule.

## Scope

`:where([data-timeline-row-id]) :where([data-markdown-preview])`: a timeline row, and BB's rendered-markdown root inside it. Measured: every list, quote, spoiler and tables in a row sits inside a markdown root; user messages have one too. A check that ran every rule's selector over the page matched 146 elements, none outside. If BB renames either attribute every rule stops matching and BB's own look returns.

## Options

`SWITCHES` and `NUMBERS` in `src/shared.ts` (import-free), each with its panel tab. `server.ts` defines them and registers `set_switch`, `set_number` (clamped with `clampNumber`) and `reset`; the page cannot write settings itself. The overlay in `app.tsx` writes, only while a value is off its default, an attribute on `<html>` per switch (`data-reply-style-guides="off"`, `data-reply-style-quote="on"`, `data-reply-style-tables="off"`) and a custom property per number (`--reply-style-quote-bar: 45%`); `styles.css` reads each as `var(--reply-style-x, <default>)`, and `src/shared.test.ts` keeps every fallback equal to its setting's default.

The settings panel (`src/Panel.tsx`, `src/panel.css`, opened from the thread action in `src/ThreadMenu.ts` through `src/panelState.ts`) follows Minimap's: draggable, Esc closes, tabs Quotes, Spoilers, Lists, Tables, two-click Reset all. The same `Content` is a `settingsSection` on BB's settings page, where `panel.css` hides BB's generated list. A slider previews through `src/preview.ts` (the overlay applies the preview over the saved values) and writes once on release, on close, or 600ms after the last step. Words the utility scan would catch (the panel's position and display values) are joined from halves in `Panel.tsx` and passed as custom properties. Headless check of a slider: abort requests to `/plugins/reply-style/rpc/` with request interception so nothing is saved.

## Guide lines

A file tree (rewritten 2026-11-19 after the user saw overlaps and breaks): one line per list, in the items' marker column (`--reply-style-rail`: 0.82em plus 1px left of the text, the same under bullets and numbers as the user asked; set from the user's screen, where headless draws the bullet about 2px further left), going from just under each marker to just over the next, with an elbow to everything under an item (nested item's marker, spoiler, quote, code fence, further paragraph). Under the last item it stops at the bottom edge of the last elbow. Only lists where some item has something under it get lines.

- No two pieces overlap or leave a gap. Thin lines land on fractional pixels; the soft edges of two overlapping pieces add up and show as darker (lighter in dark themes) spots, which the user saw with the earlier per-child pieces. Each item draws its own segment (`li::after`); elbows (`::before` of the child) start one line-width right of the line.
- The segment must know the space to the next item, so in these lists each item contains its own margins (a new formatting context: the `display` value pairs the list item keyword with the flow root one, see the stylesheet), its last child has no bottom margin, and its bottom margin is set (`--reply-style-gap`: 0.25rem, 0.5rem when something sits under it, matching BB's collapsed margins).
- The last item's segment ends with CSS anchor positioning: each last elbow is named `--reply-style-end-<level>` (levels 1 to 4 by counting `li` ancestors; 4 covers deeper), the item's `::after` uses `anchor(--reply-style-end-<level> bottom, 0px)`. A pseudo-element anchor works (Chrome 156 headless). The anchor rules tie in specificity with the segment's rule and win by order; a more specific rule there hid them once. Without an elbow (tables put straight under the item) the segment goes to the item's end.
- A nested item's elbow is placed from the parent's rail (`--reply-style-parent-rail`, passed on by the nested list) minus BB's indent (`--spacing` × 5 plus 1ch per extra marker digit, `--markdown-list-marker-digits`). These are BB variables, not class names. A quote places children from inside its bar, so the bar width comes off.
- A left rule on nested lists was rejected: it draws nothing for a spoiler or quote under an item, which is the format's main shape. Headless check: copy a reply's `[data-markdown-preview]` into an overlay pinned over the page, carrying `data-timeline-row-id` and `data-markdown-preview`; the live timeline keeps scrolling under a script.

## Spoiler As Quote

The bar goes on `::details-content` (so it grows with the content and the summary stays outside it). A quote that is a direct child of a spoiler loses its bar and padding, and the tables' margin goes to 0, so old quoted bodies and new plain ones render alike: measured one bar, body text and tables both at x 538. The mode is behind `@supports selector(details::details-content)`.

## Tables in spoilers

BB centres wide tables on the pane through `--md-table-start-offset`, read in the style attribute of two wrappers around each, so a wide one under a list item crosses the guide line and the quote bar. The plugin leaves that span alone (the user asked for full-width tables back on 2026-11-18, after trying them pinned to the spoiler's edge) and gives tables a position and `background: var(--canvas)`, so they paint over both lines. `background: inherit` computes to transparent (the parent paints nothing). A nonzero value of the property is applied twice, once per wrapper (14px gave 28px).

## Reduced motion

Under `prefers-reduced-motion: reduce` the open/close, the hover and the chevron's turn happen at once (measured: every duration 0s).

## Testing

- `pnpm --filter bb-plugin-reply-style test`: the settings list and the stylesheet guards (scope, colours, no `!important`, clip, dist check).
- Headless: cut the theme's copy out of `#bb-app-theme` in the page (`textContent` up to `/* Quotes borrow`), so you see the plugin's effect. Older rows mount only after `wheel` events on `[data-page-scroll-viewport]`. Setting `details.open` from a script is undone by BB's next render; open a spoiler with `page.mouse.click` on its summary. Force options by answering `GET /api/v1/plugins/reply-style/settings` with changed `values`; never write the user's settings.

## Ideas the user raised for later (2026-11-19)

- Checkboxes sit about 3px high against their text: an option to centre them.
- Styling list markers (the bullet, the numbers).
- Spike: nested numbers shown as a path (`1.2` rather than `2.`), so the answer key is on screen; and letters (a/b/c) as an option.
- Spike: spoilers carry no quote at all and get their padding, text colour and left bar from the plugin's settings, so the format writes plain bodies and real quotes can sit inside a spoiler. Close to Spoiler As Quote; it changes what the format writes, so the format changes in the same move.
