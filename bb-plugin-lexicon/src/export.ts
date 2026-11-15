// A lexicon written out for a person: the user asks for a file in the format they
// want and the agent saves it where they say. The plugin itself never writes to a
// checkout.
import type { Entry } from "./lexicon.ts";

export const FORMATS = ["json", "md", "yaml", "txt"] as const;
export type Format = (typeof FORMATS)[number];

/** A string as a YAML scalar. JSON strings are valid YAML flow scalars. */
const q = (value: string) => JSON.stringify(value);

/** One cell of a Markdown row: a pipe or a line break would end it. */
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

export function exportTerms(entries: readonly Entry[], format: Format): string {
  switch (format) {
    case "json":
      return JSON.stringify({ terms: entries }, null, 2);
    case "yaml":
      return [
        "terms:",
        ...entries.flatMap((e) => [
          `  - id: ${q(e.id)}`,
          `    term: ${q(e.term)}`,
          `    kind: ${e.kind}`,
          ...(e.parent ? [`    parent: ${q(e.parent)}`] : []),
          ...(e.tone ? [`    tone: ${e.tone}`] : []),
          ...(e.hue !== undefined ? [`    hue: ${e.hue}`] : []),
          ...(e.aliases.length ? [`    aliases: [${e.aliases.map(q).join(", ")}]`] : []),
          ...(e.code.length ? [`    code: [${e.code.map(q).join(", ")}]`] : []),
          ...(e.note ? [`    note: ${q(e.note)}`] : []),
        ]),
      ].join("\n");
    case "md":
      return [
        "| Term | Kind | Parent | Also called | In code | Meaning |",
        "| --- | --- | --- | --- | --- | --- |",
        ...entries.map((e) => `| ${cell(e.term)} | ${e.kind}${e.tone ? ` (${e.tone})` : ""} | ${e.parent ?? ""} | ${cell(e.aliases.join(", "))} | ${e.code.map((c) => `\`${cell(c)}\``).join(", ")} | ${cell(e.note ?? "")} |`),
      ].join("\n");
    case "txt":
      return entries
        .map((e) => `${e.term} [${e.kind}${e.parent ? ` of ${e.parent}` : ""}]${e.aliases.length ? ` also: ${e.aliases.join(", ")}` : ""}${e.code.length ? ` code: ${e.code.join(", ")}` : ""}${e.note ? ` - ${e.note.replace(/\s*\n\s*/g, " ")}` : ""}`)
        .join("\n");
  }
}
