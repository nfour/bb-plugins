---
name: lexicon
description: Use the project's lexicon. Explains how to keep one wording per concept, add, alias, rename or retire terms with the lexicon tool, and how to mine the project for terms with the mine tool (after asking the user how deep to go). Also for why a word is or is not coloured, and for lexicon files.
---

# Lexicon

The Lexicon plugin paints a project's key terms (names, features, code identifiers,
user actions, outcomes) in chat, the same way every time. The terms live in BB's
plugin storage, never in the checkout. A digest of them is in your session
instructions as data: use those wordings.

## One wording per concept
- Use the canonical term, not an alias or an old name (`not:` lists wordings that were renamed away).
- Concepts are proper nouns: write a term and its aliases in Title Case ("Sync View Order", "Flat View"), also in your replies. Code (identifiers, packages, settings, files) is written as the code spells it, closest to the real name, never re-cased.
- Aim high: concepts, features, options (named as their label in the UI), interfaces and the product's own names. Code internals (helpers, hooks, DOM and library calls, files) are not terms; give an identifier only as the `code` of the concept it implements.
- Two wordings for one concept are one term with an alias (Jank, alias Glitchiness). Related but different concepts stay separate terms: they share a colour by kind and are never merged.
- A feature has one colour whatever it belongs to; an option has its own. Choose the kind, not a colour.
- The tool writes names, features, options and topics in Title Case itself, so the stored form is always right; write them so in replies too.
- Two wordings for one thing the user used: `lexicon` op `alias`.
- A concept changed name: op `rename` with the reason. The old wording stays and is painted as stale, so leftovers show up.
- Something was removed or no longer applies: op `retire` with the reason.
- You create, locate or keep coming back to a concept with no term: op `add` with `kind`, a one-line `note`, the aliases the user used and the code identifiers. Check first with op `list` and a `query`.
- Terms marked user-added are the user's: you may only add aliases to them.
- The tool refuses plain single words, wordings someone else owns, and more than a few changes per thread. A refusal says why; do not retry around it. If the project asks for proposals, your change waits for the user's approval; keep using the current wording meanwhile.

## Mining
Use `mine` to find candidates when the lexicon is thin or the user asks. Do it in this order:
1. Look at the project yourself first (README, top-level folders).
2. Ask the user how deep to go and offer: the full codebase, part of it (a folder), the project's past session replies, or nothing, "all good".
3. Ask whether there are other sources you should mine as well (docs, tickets, a glossary, a wiki); read those yourself.
4. Run `mine` at the chosen depth (`source` code with an optional `path`, or sessions; `depth` quick or full).
5. Judge the candidates. Add only real concepts, with notes, a few at a time; skip generic names.

## Terms the user picks
When a message carries a "Lexicon term" pill (typed with `~`), it is the user naming a concept exactly; use that wording in your reply and code comments.

## Kinds
`name` (packages, products), `feature` (something the product has or does), `option` (a setting or mode the user can switch; its own colour), `code` (identifiers), `action` (what a person does), `outcome` (how work turned out; `tone` good, bad or neutral), `topic` (what a stretch of work is about). `parent` groups a term under another; a child of the same kind takes its colour. You cannot set colours.

## Files and checks
`bb lexicon export --format json|md|yaml|txt [--all]` prints the project's terms so the user can have them saved in the codebase (only when they ask; the plugin never writes there). `bb lexicon import <file.json>` replaces them; `bb lexicon lint <file>` checks a file. No style draws a line: links already do. Matching is by whole word; a hyphen, underscore or `.ext` joins a word to its neighbour; fenced code is not painted.
