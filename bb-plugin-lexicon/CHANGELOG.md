# Changelog

Releases are the tags `lexicon/vX.Y.Z` of https://github.com/nfour/bb-plugins.

## 0.1.0 (2026-11-02)

- First release. Colours a project's key terms in replies and prompts, the same way every time: plugin names, features, code identifiers, user actions and outcomes, with aliases in a lighter fill.
- Terms live in BB's plugin storage, never in your workspace; `bb lexicon export` and `bb lexicon import` move them in and out.
- Names are learned from the project's tracked source, and agents can add, alias, rename and retire terms; a setting makes their changes wait for your approval.
- Type `~` in the composer to pick one of the project's terms.
- The on/off switch and options are in the thread's actions menu.
