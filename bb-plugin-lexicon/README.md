# Lexicon

Colours a project's key terms in chat, the same way every time: plugin names,
features, code identifiers, user actions, outcomes. A term has one canonical
wording; its aliases are painted like it, in a lighter fill, so a feature the team
has called three things reads as one.

Nothing is written to your workspace. Terms live in BB's plugin storage, with a
built-in set of outcomes and actions, and names learned from the project's source.
Ask for `bb lexicon export --format md` (or json, yaml, txt) to keep a copy in the
codebase. `examples/lexicon.json` shows the shape; `bb lexicon import` loads one.

## Switching a term off

Each term on the Lexicon page has a Disable button. A disabled term stays in the
list, keeps its wordings (nothing else can claim them) and can be enabled again, but
it is no longer coloured, offered after `~` or shown to agents, and agents cannot
change it. Disabling a built-in word applies to every project.

## Typing a term

Type `~` in the composer to list the project's terms (best match first). Picking one inserts a pill; the agent receives the term's wording, kind, meaning, aliases and code identifiers with the message, so it uses the project's own name for what you meant.
