import type { Hit, Kind } from "./lexicon.ts";

/** What the popover of a clicked word says: no markup, only text, since terms can come from an agent. */
export interface Explanation {
  /** The canonical term. */
  title: string;
  /** "Feature", "Outcome (good)", ... and whose it is. */
  kind: string;
  /** One line per fact, in order. */
  lines: string[];
}

const KIND_NAME: Record<Kind, string> = { name: "Name", feature: "Feature", option: "Option", code: "Code", action: "Action", outcome: "Outcome", topic: "Topic" };
const MAX_ALIASES_SHOWN = 6;

/** Says what `word`, as it stands in the text, is in the lexicon. */
export function explain(hit: Hit, word: string): Explanation {
  const { entry, via } = hit;
  const title = entry.term || word;
  const lines: string[] = [];
  if (via === "alias") lines.push(`"${word}" is another wording of ${title}.`);
  else if (via === "code") lines.push(`"${word}" is how ${title} is spelled in code.`);
  else if (via === "stale") lines.push(`"${word}" is an old wording; it is now ${title}.`);
  if (entry.note) lines.push(entry.note);
  const others = entry.aliases.filter((alias) => alias.toLowerCase() !== word.toLowerCase());
  if (others.length) lines.push(`Also called: ${others.slice(0, MAX_ALIASES_SHOWN).join(", ")}${others.length > MAX_ALIASES_SHOWN ? ", ..." : ""}`);
  if (entry.stale) lines.push(`May be out of date: ${entry.stale}`);
  const who = entry.status === "auto" ? "added by an agent" : entry.by === "agent" ? "kept by you" : "yours";
  return { title, kind: `${KIND_NAME[entry.kind]}${entry.tone ? ` (${entry.tone})` : ""}, ${entry.disabled ? "switched off" : who}`, lines };
}
