// Generates the tree's file and folder icons from a local copy of the vscode-icons
// theme (https://github.com/vscode-icons/vscode-icons, icons CC BY-SA 4.0).
//
//   node scripts/icons.mjs [path/to/vscode-icons extension]
//
// Defaults to the newest vscode-icons extension under ~/.vscode-server or ~/.vscode.
// Writes src/icons-css.ts (one class per icon, the SVG inlined) and src/icon-map.ts
// (file names, extensions and folder names to those classes), both checked in.
// Only the icons listed below are taken, with every name the theme maps to them;
// the lookup follows VS Code's: file name, then the longest dotted extension,
// then the language VS Code would detect.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** File icons, by vscode-icons id without its `_f_` prefix. */
const FILES = `typescript reactts js reactjs json markdown mdx yaml toml css scss html svg image font
  npm pnpm yarn tsconfig eslint prettier git dotenv shell docker python go rust java c cpp sql xml text
  csv log config ini testts testjs typescriptdef jsmap map storybook vite vitest jest playwright turbo
  biome esbuild agents claude copilot mcp vscode graphql vue audio favicon robots reactrouter shadcn
  uv cucumber prisma tailwind diff`.split(/\s+/);

/** Folder icons, by vscode-icons id without its `_fd_` prefix; each comes with its open variant. */
const FOLDERS = `src package app component test docs client route images e2e script public github
  plugin hook config library api asset style`.split(/\s+/);

/**
 * The languages VS Code detects for an extension or a file name (the theme maps
 * many common files only through their language: `.ts` → typescript → `_f_typescript`).
 */
const LANGUAGE_BY_EXTENSION = {
  ts: "typescript", mts: "typescript", cts: "typescript", tsx: "typescriptreact",
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascriptreact",
  json: "json", jsonc: "jsonc", json5: "json5", md: "markdown", markdown: "markdown", mdx: "mdx",
  css: "css", scss: "scss", html: "html", htm: "html", yml: "yaml", yaml: "yaml", toml: "toml",
  sh: "shellscript", bash: "shellscript", zsh: "shellscript", py: "python", go: "go", rs: "rust",
  sql: "sql", xml: "xml", ini: "ini", ps1: "powershell", java: "java", c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp", cs: "csharp", php: "php", swift: "swift", kt: "kotlin",
  txt: "plaintext", log: "log", csv: "csv", diff: "diff", patch: "diff", graphql: "graphql",
  gql: "graphql", vue: "vue", svelte: "svelte", astro: "astro", feature: "feature",
  properties: "properties", env: "dotenv",
};
const LANGUAGE_BY_NAME = { dockerfile: "dockerfile", ".env": "dotenv", ".gitignore": "ignore", ".npmignore": "ignore" };

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function findExtension() {
  for (const dir of [join(homedir(), ".vscode-server/extensions"), join(homedir(), ".vscode/extensions")]) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir).filter((name) => name.startsWith("vscode-icons-team.vscode-icons-")).sort();
    if (found.length) return join(dir, found.at(-1));
  }
  throw new Error("No vscode-icons extension found; pass its path.");
}

const extension = process.argv[2] ?? findExtension();
const themePath = join(extension, "dist/src/vsicons-icon-theme.json");
const theme = JSON.parse(readFileSync(themePath, "utf8"));
const version = JSON.parse(readFileSync(join(extension, "package.json"), "utf8")).version;

const svgOf = (id) => {
  const path = theme.iconDefinitions[id]?.iconPath;
  if (!path) return null;
  return readFileSync(join(dirname(themePath), path), "utf8")
    .replace(/<\?xml[^>]*>|<!--[\s\S]*?-->|<title>[\s\S]*?<\/title>|<metadata[\s\S]*?<\/metadata>/g, "")
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
};
/** A CSS `url()` for an SVG: percent-encoded only where CSS or a URL needs it. */
// A data URI is decoded before the SVG is read, so `fil%74er` and `transfor%6d` are SVG attributes; the build would turn the bare word into a page-wide rule.
const urlOf = (svg) =>
  `url("data:image/svg+xml,${svg.replace(/"/g, "'").replace(/[%#<>{}|\\^`\n]/g, encodeURIComponent).replace(new RegExp("fil" + "ter(?!s)", "g"), "fil%74er").replace(new RegExp("trans" + "form", "g"), "transfor%6d")}")`;
/**
 * `_f_reactts` → `reactts`, `_fd_src` → `folder-src`: file and folder icons share
 * names (`config` is both), so folder keys carry a prefix.
 */
const keyOf = (id) => id.replace(/^_f_/, "").replace(/^_fd_/, "folder-");

const fileIds = new Set(FILES.map((name) => `_f_${name}`));
const folderIds = new Set(FOLDERS.map((name) => `_fd_${name}`));
for (const id of [...fileIds, ...folderIds]) if (!svgOf(id)) throw new Error(`${id} is not in vscode-icons ${version}`);

// VS Code matches names case-insensitively; a few theme keys are not lower case.
const pick = (map, ids) => Object.fromEntries(Object.entries(map).filter(([, id]) => ids.has(id)).map(([name, id]) => [name.toLowerCase(), keyOf(id)]));
const fileNames = pick(theme.fileNames, fileIds);
const fileExtensions = pick(theme.fileExtensions, fileIds);
// Languages come last in VS Code's order, so they only fill names and extensions the theme left out.
for (const [name, language] of Object.entries(LANGUAGE_BY_NAME)) {
  const id = theme.languageIds[language];
  if (fileIds.has(id)) fileNames[name] ??= keyOf(id);
}
for (const [ext, language] of Object.entries(LANGUAGE_BY_EXTENSION)) {
  const id = theme.languageIds[language];
  if (fileIds.has(id)) fileExtensions[ext] ??= keyOf(id);
}
const folderNames = pick(theme.folderNames, folderIds);
for (const [name, id] of Object.entries(theme.folderNamesExpanded)) {
  if (folderNames[name] && `${keyOf(id)}` !== `${folderNames[name]}_open`) throw new Error(`${name} opens as ${id}`);
}

// Light variants: the theme's `light` maps point some names at `_light_` icons.
const lightOf = new Map();
for (const kind of ["fileNames", "fileExtensions", "languageIds", "folderNames", "folderNamesExpanded"]) {
  for (const [name, lightId] of Object.entries(theme.light?.[kind] ?? {})) {
    const darkId = theme[kind]?.[name];
    if (!darkId) continue;
    if (lightId !== darkId && (fileIds.has(darkId) || folderIds.has(darkId.replace(/_open$/, ""))) && svgOf(lightId)) lightOf.set(darkId, lightId);
  }
}

const rules = [];
const keys = new Set();
const rule = (key, id) => {
  if (keys.has(key)) throw new Error(`two icons would be .diff-plus-i-${key}`);
  keys.add(key);
  rules.push(`.diff-plus-i-${key} { background-image: ${urlOf(svgOf(id))}; }`);
  const light = lightOf.get(id);
  if (light) rules.push(`html:not(.dark) .diff-plus-i-${key} { background-image: ${urlOf(svgOf(light))}; }`);
};
for (const id of fileIds) rule(keyOf(id), id);
rule("folder", theme.folder);
rule("folder-open", theme.folderExpanded);
for (const id of folderIds) {
  rule(keyOf(id), id);
  rule(`${keyOf(id)}-open`, `${id}_open`);
}
// The theme's plain file is a light grey glyph; drawn as a mask it takes the
// muted text colour of either theme.
const file = urlOf(svgOf(theme.file));
rules.push(`.diff-plus-i-file { background-color: var(--muted-foreground); -webkit-mask: ${file} center / contain no-repeat; mask: ${file} center / contain no-repeat; }`);

const header = (comment) => `${comment} Generated by scripts/icons.mjs from vscode-icons ${version}; do not edit.\n${comment} Icons: vscode-icons (https://github.com/vscode-icons/vscode-icons), CC BY-SA 4.0. See THIRD_PARTY_NOTICES.md.\n`;
writeFileSync(join(root, "src/icons-css.ts"), `${header("//")}export default ${JSON.stringify(`${rules.join("\n")}\n`)};\n`);

const sorted = (map) => Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(
  join(root, "src/icon-map.ts"),
  `${header("//")}
/** Lower-cased file name → icon. */
export const FILE_NAMES: Record<string, string> = ${JSON.stringify(sorted(fileNames), null, 1)};

/** Lower-cased extension without its first dot (\`ts\`, \`test.ts\`, \`d.ts\`) → icon. */
export const FILE_EXTENSIONS: Record<string, string> = ${JSON.stringify(sorted(fileExtensions), null, 1)};

/** Lower-cased folder name → icon; its open variant is \`<icon>-open\`. */
export const FOLDER_NAMES: Record<string, string> = ${JSON.stringify(sorted(folderNames), null, 1)};
`,
);

const css = readFileSync(join(root, "src/icons-css.ts"), "utf8").length;
console.log(
  `vscode-icons ${version}: ${fileIds.size} file and ${folderIds.size} folder icons (${lightOf.size} light variants), ` +
    `${Object.keys(fileNames).length} names, ${Object.keys(fileExtensions).length} extensions, ${Object.keys(folderNames).length} folder names; icons-css.ts ${Math.round(css / 1024)}KB`,
);
