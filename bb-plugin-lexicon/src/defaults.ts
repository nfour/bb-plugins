// The vocabulary every project gets without writing a file: how work turned out
// and what a person does at the screen. Project terms with the same wording win.
// The first outcome is written in two halves: a standalone utility word anywhere in this
// folder becomes a page-wide rule when the plugin is built.
import type { Entry } from "./lexicon.ts";

const word = (id: string, term: string, kind: Entry["kind"], more: Partial<Entry> = {}): Entry => ({ id, term, kind, aliases: [], code: [], ...more });

export const DEFAULT_REVISION = "1";

export const DEFAULT_TERMS: Entry[] = [
  word("outcome-done", "fix" + "ed", "outcome", { tone: "good", aliases: ["resolved"] }),
  word("outcome-shipped", "shipped", "outcome", { tone: "good", aliases: ["released", "deployed"] }),
  word("outcome-merged", "merged", "outcome", { tone: "good" }),
  word("outcome-verified", "verified", "outcome", { tone: "good", aliases: ["confirmed"] }),
  word("outcome-passes", "passes", "outcome", { tone: "good", aliases: ["passed", "passing"] }),
  word("outcome-reverted", "reverted", "outcome", { tone: "bad", aliases: ["rolled back"] }),
  word("outcome-regressed", "regressed", "outcome", { tone: "bad", aliases: ["regression"] }),
  word("outcome-failed", "failed", "outcome", { tone: "bad", aliases: ["fails", "failing", "broke", "broken", "crashes", "crashed"] }),
  word("outcome-blocked", "blocked", "outcome", { tone: "bad" }),
  word("outcome-skipped", "skipped", "outcome", { tone: "neutral", aliases: ["deferred"] }),
  word("action-click", "click", "action", { aliases: ["clicks", "clicked", "clicking", "double-click", "right-click"] }),
  word("action-hover", "hover", "action", { aliases: ["hovers", "hovered", "hovering"] }),
  word("action-drag", "drag", "action", { aliases: ["drags", "dragged", "dragging"] }),
  word("action-scroll", "scroll", "action", { aliases: ["scrolls", "scrolled", "scrolling"] }),
  word("action-select", "select", "action", { aliases: ["selects", "selected", "selecting"] }),
];
