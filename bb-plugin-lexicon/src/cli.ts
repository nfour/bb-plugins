// `bb lexicon lint | import | export`. The commands only read and write through
// the callbacks the backend hands in, so they hold no state of their own.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { cliCommand, defineCli, PluginCliError } from "@get-bb/plugin-sdk";
import { DEFAULT_TERMS } from "./defaults.ts";
import { exportTerms, FORMATS } from "./export.ts";
import { parseLexicon } from "./lexicon.ts";
import { emptyStore, type Store } from "./store.ts";

/** Larger imports are refused: a vocabulary is a few hundred lines. */
const MAX_BYTES = 256 * 1024;

export interface CliEnv {
  load(projectId: string): Promise<Store>;
  mutate(projectId: string, change: (store: Store) => { store: Store }): Promise<unknown>;
}

async function readText(file: string, cwd: string | undefined): Promise<string> {
  const path = resolve(cwd ?? process.cwd(), file);
  try {
    return await readFile(path, "utf8");
  } catch {
    throw new PluginCliError(`cannot read ${path}`, { code: "file_not_found" });
  }
}

const projectOf = (context: { projectId?: string }) => {
  if (!context.projectId) throw new PluginCliError("no project: run this from a BB thread", { code: "no_project" });
  return context.projectId;
};

export const lexiconCli = ({ load, mutate }: CliEnv) =>
  defineCli({
    name: "lexicon",
    summary: "The project's vocabulary, kept in BB's storage",
    commands: {
      lint: cliCommand({
        summary: "Check a lexicon file for duplicate terms, wordings with two owners and bad parents",
        positionals: [{ name: "file", description: "Path to a JSON lexicon", required: true }],
        options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
        async run(input, context) {
          const { entries, issues } = parseLexicon(await readText(input.positionals.file, context.cwd));
          const errors = issues.filter((found) => found.level === "error").length;
          if (input.options.json) return { exitCode: errors ? 1 : 0, stdout: JSON.stringify({ terms: entries.length, issues }, null, 2) };
          const lines = issues.map((found) => `${found.level}: ${found.entry ? `${found.entry}: ` : ""}${found.message}`);
          lines.push(`${entries.length} terms, ${errors} errors, ${issues.length - errors} warnings`);
          return { exitCode: errors ? 1 : 0, stdout: lines.join("\n") };
        },
      }),
      import: cliCommand({
        summary: "Keep a JSON lexicon file as this project's terms (replaces the current ones and the proposals waiting)",
        positionals: [{ name: "file", description: "Path to a JSON lexicon", required: true }],
        async run(input, context) {
          const projectId = projectOf(context);
          const text = await readText(input.positionals.file, context.cwd);
          if (text.length > MAX_BYTES) throw new PluginCliError("the file is too large", { code: "lexicon_too_large" });
          const { entries, issues } = parseLexicon(text);
          if (!entries.length) throw new PluginCliError("no usable terms in the file", { code: "lexicon_empty", hint: issues[0]?.message });
          await mutate(projectId, (store) => ({ store: { ...emptyStore(), terms: entries, rev: store.rev + 1 } }));
          return { exitCode: 0, stdout: `kept ${entries.length} terms${issues.length ? `, ${issues.length} issues (run bb lexicon lint)` : ""}` };
        },
      }),
      export: cliCommand({
        summary: "Print this project's terms as json, md, yaml or txt, to save wherever the project wants them",
        options: {
          format: { type: "enum", values: [...FORMATS], default: "json", description: "Output format" },
          all: { type: "boolean", description: "Include the built-in outcomes and actions" },
        },
        async run(input, context) {
          const own = (await load(projectOf(context))).terms;
          const ids = new Set(own.map((e) => e.id));
          const entries = input.options.all ? [...own, ...DEFAULT_TERMS.filter((e) => !ids.has(e.id))] : own;
          return { exitCode: 0, stdout: exportTerms(entries, input.options.format) };
        },
      }),
    },
  });
