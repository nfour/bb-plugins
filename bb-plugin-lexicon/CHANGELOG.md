# Changelog

Releases are the tags `lexicon/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.2.0 (2026-11-15)

- A Lexicon page (a tab in the nav and a section in plugin settings): every project's terms grouped by kind, each kind collapsible and always listed, two-line rows with the meaning, counts per project, Undo last change, and a collapsible "Plugin global settings" box with a description for each switch.
- Add a term yourself ("+ Add term" per kind), or select words in a reply and choose "Add to lexicon" to add them as a new term or as another wording of an existing one.
- Disable a term (or a built-in word) to stop it being coloured, suggested or shown to agents without deleting it.
- Choose which kinds of term are coloured, and whether your own messages are coloured too.
- A new "option" kind for settings and modes, with its own colour; names, features, options and topics are kept in Title Case.
- Agents can add, alias, rename and retire terms (or propose them for your approval), mine the project for candidates, and are told the project's terms; terms that go out of use are flagged stale.
- Type `~` in the composer to pick one of the project's terms; the agent receives its meaning.
- Click a coloured word to see which term it is: its canonical wording, kind, meaning and other wordings (an old wording says what replaced it).
- Changes show at once, wherever they are made (another window, an agent, the Lexicon page), instead of within four seconds; the page no longer asks the backend again every few seconds.
- Exports (Markdown, YAML, text) now carry each term's meaning, and a pipe in a term no longer breaks a Markdown row.
- Streaming replies repaint only the paragraph that changed, and nothing polls or scans while the tab is in the background.

## 0.1.0 (2026-11-02)

- First release. Colours a project's key terms in replies and prompts, the same way every time: plugin names, features, code identifiers, user actions and outcomes, with aliases in a lighter fill.
- Terms live in BB's plugin storage, never in your workspace; `bb lexicon export` and `bb lexicon import` move them in and out.
- Names are learned from the project's tracked source, and agents can add, alias, rename and retire terms; a setting makes their changes wait for your approval.
- Type `~` in the composer to pick one of the project's terms.
- The on/off switch and options are in the thread's actions menu.
