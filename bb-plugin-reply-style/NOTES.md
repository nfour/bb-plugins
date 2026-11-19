# Reply Style: notes for agents

What an agent working on this plugin must know. The user-facing description is `README.md`. BB facts below were checked on bb-app 0.49.0 in a headless page and are undocumented.

## Scope the user set (2026-11-19)

- The user runs the dark theme by default: check dark first; it is the main target. No separate dark-theme pass is owed.
- No release, no README screenshots: the plugin is for the user's own BB, not the marketplace.

## The format this styles

Since 2026-11-18 this plugin's thread (`thr_ig7mwdgfv8`) owns the `reply-style` format as well as its CSS, because the two change together. The format lives in `/home/dev/.agents/skills/reply-style/` (git repo `~/.agents`, one commit per change, with the reason): `core.md` (the always-on rules, applied with `bb instructions set`), `SKILL.md`, `example.md`, and `styling.css`, now only a pointer to `src/styles.css`. Read `HANDOVER.md` there before changing any of it: it holds the settled decisions, the 4,096 cap (counted as a JavaScript string length) and BB's renderer facts. The rules used to be pasted into the user's theme `~/.bb/theme/null-syntax/theme.css`; that copy is gone and must not come back.

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

## Checkboxes

BB leaves a task item's checkbox on the baseline: its middle sat 2px above the middle of the capitals and 3px above the middle of the small letters (Inter, 13px, measured 2026-11-19; the user saw about 3px). The first checkbox of an item's first line moves down by `--reply-style-checkbox` (Checkbox drop, 2.5px, 0 to 6 in half pixels) by an offset from where it stood, so the line keeps its height.

## Spoiler As Quote

On by default since 2026-11-19, when the format stopped quoting spoiler bodies (`core.md`, `SKILL.md`, `example.md` changed in the same step; the user's saved value, stored off by an earlier Reset all, was turned on through `set_switch`). The bar goes on `::details-content` (so it grows with the content and the summary stays outside it), and the body's direct children and their p/li/em/strong take the quote text colour. A quote inside a spoiler keeps its own bar: the user chose that (2026-11-19) over hiding the bar of a quote right inside a spoiler, so replies from before the change show two bars. The mode is behind `@supports selector(details::details-content)`.

## Height Limit and the summary line

Height Limit (off) puts `max-block-size` and `overflow-y: auto` on `details[open]::details-content` (checked headless: a 740px-tall set of rows in a 120px body scrolls inside it, the page does not move), so the summary stays outside the scroller. Screen Height Units (on) chooses `--reply-style-limit-vh` (50vh) or `--reply-style-limit-px` (480px); a number with `when` in `src/shared.ts` is greyed out in the panel while its switch is the other way. The scroller also scrolls sideways, so a wide one scrolls inside the body instead of spanning. No reflow when the scrollbar appears (the user asked, 2026-11-19): the body keeps `scrollbar-gutter: stable` and a negative end margin of `--reply-style-scrollbar`, which `app.tsx` measures with a probe while Height Limit is on (BB sets thin scrollbars: 10px headless; overlay scrollbars give 0) and again when the window changes size. Measured: text 573.8px wide with the limit off, on and overflowing, and on and not overflowing.

An opened spoiler's summary stays pinned (`position` set to stick) at the top of the timeline (the user asked, 2026-11-19), on a `--canvas` surface at `z-index: 2`, above tables (`z-index: 1` under Tables Surface, so they cover the line down an item, which is its `::after` and later in the tree). On a highlighted message it shows the plain canvas. A level on tables alone was not enough inside a spoiler: `::details-content` has a `clip-path` (the open/close reveal), which makes it a stacking context, so the level only counted inside it; a spoiler holding one is raised to `z-index: 1` itself (it paints nothing of its own). `elementFromPoint` ignores pseudo-elements, so check lines crossing tables with a screenshot, not a hit test.

## Path Numbers and Dim Markers

Path Numbers (off by default, the user's choice) only touches `[data-markdown-preview] > ol > li > ol > li`, the Needs you shape: a counter of the plugin's own (`reply-style-question`) on the outer items gives `1.1.`; `counters(list-item)` showed `1.1.2` once a bullet list came earlier in the reply, because a counter's scope runs on into later siblings. A `start` on the outer list is not followed, and the options stay where plain numbers put them (the user preferred that to moving them right by 1.6ch, 2026-11-19). The marker shows only the option's number. The question's part ("1." of 1.3) is the item's ::before at 0.75 size, raised like a superscript and at 75% of the marker strength (the user, 2026-11-19). The same box is the elbow: it runs from the guide line to where the marker begins (1.22em left of the item: a tabular digit plus ". " in Inter, so options past 9 would overlap), with the elbow as a background line on its bottom edge and the number at its end. Lengths from the item reach the smaller font through registered properties (`--reply-style-path-x`, `--reply-style-path-half`), which turn them into pixels on the item. The box ends at mid-line, so the question's line still ends at its last elbow. Lettered options were tried and turned down, since answers would become `1a`. Dim Markers (on) gives `li::marker` its own strength, `--reply-style-marker` (45%): at the guide colour (18%) the user found the numbers too faint.

## Tables in spoilers

BB centres wide tables on the pane through `--md-table-start-offset`, read in the style attribute of two wrappers around each, so a wide one under a list item crosses the guide line and the quote bar. The plugin leaves that span alone (the user asked for full-width tables back on 2026-11-18, after trying them pinned to the spoiler's edge) and gives tables a position and `background: var(--canvas)`, so they paint over both lines. `background: inherit` computes to transparent (the parent paints nothing). A nonzero value of the property is applied twice, once per wrapper (14px gave 28px).

## Reduced motion

Under `prefers-reduced-motion: reduce` the open/close, the hover and the chevron's turn happen at once (measured: every duration 0s).

## Testing

- `pnpm --filter bb-plugin-reply-style test`: the settings list and the stylesheet guards (scope, colours, no `!important`, clip, dist check).
- Headless: cut the theme's copy out of `#bb-app-theme` in the page (`textContent` up to `/* Quotes borrow`), so you see the plugin's effect. Older rows mount only after `wheel` events on `[data-page-scroll-viewport]`. Setting `details.open` from a script is undone by BB's next render; open a spoiler with `page.mouse.click` on its summary. Force options by answering `GET /api/v1/plugins/reply-style/settings` with changed `values`; never write the user's settings.

## Panel layout

`LAYOUT` in `src/shared.ts` lists each tab's rows: a setting, or a switch with the settings that only act while it is on (`children`), shown indented behind a line and greyed out and disabled while the switch is off (the user asked for this grouping, 2026-11-19). A test holds that every setting appears once, on its own tab, nested only under a switch.

## Spoiler Card and Fit Spoilers

Spoiler Card (off) is a box on the `details` element itself, so the summary is inside it (the user asked, 2026-11-19). It is always there (1px edge line, 0.15rem by 0.6rem padding) so opening moves nothing; closed, the edge line and shade are `transparent`, and they fade in over the open time. `::details-content` loses Spoiler As Quote's bar in this mode and keeps the open/close clip; the shade is on `details`, so it is never cut. A spoiler's elbow moves down by the padding and the edge (`--reply-style-mid`) and reaches the box (`--reply-style-reach: 0px`). The shade is `color-mix(in oklch, black N%, transparent)`, the only colour not from `--ink`/`--canvas` (ink is light in a dark theme and would glow); the colour test allows exactly that one. In dark themes it barely shows.

Fit Spoilers (off) holds wide tables inside a spoiler to its width: BB's outer wrapper sets its width inline, and `max-width: 100%` (which it does not set) wins over it; `--md-table-start-offset: 0px` on the spoiler zeroes both wrappers' start margins. Measured: wrapper 73 to 739 inside a spoiler at 60 to 752, instead of the 846px breakout.

## Ideas the user raised (2026-11-19)

All four are done: centred checkboxes, dimmed markers, path numbers (a switch, off) and spoiler bodies without quotes.

## Spacing the format no longer writes (2026-11-19)

To shorten the always-on core (the user asked for rules the plugin can carry to leave it), the format stopped writing `&nbsp;` after a task box and before a spoiler's chips, and `<br>` around a spoiler standing on its own. The plugin draws those gaps: a checkbox's end margin is the browser's 3px plus 0.28em, the chevron's end margin gains 0.28em, and a spoiler that is a direct child of the message gets 1rem above and below (Spoiler Card keeps its 0.25rem only under list items). Measured headless: box to text 10.3px new form, 13.9px old; summary start to first chip 16.3px new, 20px old; 16px above and below a standalone spoiler. Older replies still carry the characters and sit one space wider (put to the user as the cost, 2026-11-19).
