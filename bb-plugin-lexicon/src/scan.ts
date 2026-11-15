// Reads a checkout's tracked files: the learned names (`scan`) and the files the
// `mine` tool counts (`trackedFiles`). Backend only; nothing is written.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportedNames, packageName } from "./symbols.ts";

export const MAX_FILES = 1200;
export const MAX_FILE_BYTES = 200 * 1024;

const run = (file: string, args: string[]) =>
  new Promise<string>((done, fail) => execFile(file, args, { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => (error ? fail(error) : done(stdout))));

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.js", "*.jsx", "*.mjs"];
const DOC_GLOBS = ["*.md", "*.py", "*.go", "*.rs", "*.java", "*.kt", "*.rb", "*.cs"];

/** Files git tracks that match `globs`, minus tests, declarations, dependencies and lock files. */
async function listFiles(path: string, globs: string[]): Promise<string[]> {
  const listed = await run("git", ["-C", path, "ls-files", "-z", "--", ...globs]);
  return listed.split("\0").filter((file) => file && !file.includes(".test.") && !file.endsWith(".d.ts") && !file.includes("node_modules/") && !file.endsWith("lock.json"));
}

/** Tracked source and docs files in `path` (a local git checkout), optionally under one folder, at most `max`. */
export async function trackedFiles(path: string, folder: string, max: number): Promise<string[]> {
  const globs = [...SOURCE_GLOBS, ...DOC_GLOBS].map((glob) => (folder ? `${folder}/**/${glob}` : glob));
  return (await listFiles(path, globs)).slice(0, max);
}

/** Package names and exported compound identifiers of the tracked source in `path`. `complete` is false when files were left unread, so absences prove nothing. */
export async function scan(path: string): Promise<{ packages: string[]; identifiers: Set<string>; complete: boolean }> {
  const all = await listFiles(path, [...SOURCE_GLOBS, "package.json", "*/package.json"]);
  const files = all.slice(0, MAX_FILES);
  const packages: string[] = [];
  const identifiers = new Set<string>();
  let complete = all.length <= MAX_FILES;
  for (let at = 0; at < files.length; at += 16) {
    await Promise.all(
      files.slice(at, at + 16).map(async (file) => {
        try {
          const text = await readFile(resolve(path, file), "utf8");
          if (text.length > MAX_FILE_BYTES) {
            complete = false;
            return;
          }
          if (file.endsWith("package.json")) {
            const name = packageName(text);
            if (name) packages.push(name);
          } else for (const name of exportedNames(text)) identifiers.add(name);
        } catch {
          complete = false;
        }
      }),
    );
  }
  return { packages, identifiers, complete };
}
