# Lexicon

Colours a project's key terms in chat, the same way every time: plugin names,
features, code identifiers, user actions, outcomes. A term has one canonical
wording; its aliases are painted like it, in a lighter fill, so a feature the team
has called three things reads as one.

Nothing is written to your workspace. Terms live in BB's plugin storage, with a
built-in set of outcomes and actions, and names learned from the project's source.
Ask for `bb lexicon export --format md` (or json, yaml, txt) to keep a copy in the
codebase. `examples/lexicon.json` shows the shape; `bb lexicon import` loads one.

## The Lexicon page

Open Lexicon in the nav (or the plugin's settings) to see every project's terms, grouped by kind: names, features, options, code, actions, outcomes and topics. The built-in outcome and action words are a "Global rules" row. Use "+ Add term" on a kind to add one, Pin, Keep, Remove and Disable on a row, and "Undo last change" to take back the newest edit. The "Plugin global settings" box at the top switches colouring on and off, learning names from the source, agent maintenance (and whether their changes wait for your approval), colouring your own messages, and which kinds are coloured. Each project has its own lexicon, and two panes on different projects each use their own.

## Clicking a word

Click a coloured word in a reply to see which term it is: the canonical wording, its kind, what it means, its other wordings, and whose it is. Clicking an alias or an old wording says what it stands for. Links and selecting text work as usual; click elsewhere or press Escape to close the card.

## Adding from a reply

Select words in an assistant reply and choose "Add to lexicon" (it is also on each message's action bar). Add them as a new term of a kind, or as another wording of a term the project already has.

## Agents

Agents get the project's terms and the `lexicon` and `mine` tools: they use one wording per concept and may add, alias, rename and retire terms. Their additions are painted lighter until you pin them, terms that go out of use are flagged stale, and a setting makes agent changes wait for your approval.

## Switching a term off

Each term on the Lexicon page has a Disable button. A disabled term stays in the
list, keeps its wordings (nothing else can claim them) and can be enabled again, but
it is no longer coloured, offered after `~` or shown to agents, and agents cannot
change it. Disabling a built-in word applies to every project.

## Typing a term

Type `~` in the composer to list the project's terms (best match first). Picking one inserts a pill; the agent receives the term's wording, kind, meaning, aliases and code identifiers with the message, so it uses the project's own name for what you meant.
