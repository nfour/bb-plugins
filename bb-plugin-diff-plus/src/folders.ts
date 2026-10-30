// The folder tree beside BB's Diff tab: its pure pieces, tested by
// src/folders.test.ts. The DOM side is in src/diff-tab.ts, the rows in src/Tree.tsx.

export type ChangeKind = "added" | "copied" | "deleted" | "modified" | "renamed" | "type_changed";

export interface TreeFile {
  path: string;
  previousPath: string | null;
  additions: number;
  deletions: number;
  changeKind: ChangeKind;
  /** Not in git yet (an added file git does not track). */
  untracked: boolean;
  /** What "Viewed" is recorded against. */
  revision: string;
}

/** The colour families of VS Code's git decorations. */
export type Tone = "added" | "modified" | "deleted";

/** A file's letter and colour, as VS Code's git decorations draw them. */
export function statusOf(file: TreeFile): { mark: string; title: string; tone: Tone } {
  if (file.untracked) return { mark: "A", title: "Added (untracked)", tone: "added" };
  switch (file.changeKind) {
    case "added":
      return { mark: "A", title: "Added", tone: "added" };
    case "copied":
      return { mark: "C", title: "Copied", tone: "added" };
    case "renamed":
      return { mark: "R", title: "Renamed", tone: "added" };
    case "deleted":
      return { mark: "D", title: "Deleted", tone: "deleted" };
    case "type_changed":
      return { mark: "T", title: "Type changed", tone: "modified" };
    default:
      return { mark: "M", title: "Modified", tone: "modified" };
  }
}

export interface TreeDir {
  /** The folder's path, no trailing slash; "" for the root. */
  path: string;
  /** What its row shows: its name, or a chain of single-folder folders joined by "/". */
  name: string;
  dirs: TreeDir[];
  files: TreeFile[];
  /** Its folders and files in the order the rows show them. */
  entries: (TreeDir | TreeFile)[];
  /** Files anywhere under it. */
  count: number;
  additions: number;
  deletions: number;
  /** Its dot's colour: one tone when every file under it shares it, "modified" for a mix; null when empty. */
  tone: Tone | null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/**
 * The files as a folder tree: folders first, then files, each in natural order.
 * With `compact`, a folder that holds nothing but one folder is folded into it
 * ("apps/docs"), so deep paths do not cost a row per level. With `synced`, each
 * folder's folders and files keep the order of `files` instead (BB's file cards
 * come in that order), a folder standing where its first file does.
 */
export function buildTree(files: readonly TreeFile[], compact = true, synced = false): TreeDir {
  const root: TreeDir = { path: "", name: "", dirs: [], files: [], entries: [], count: 0, additions: 0, deletions: 0, tone: null };
  const rank = new Map<TreeDir | TreeFile, number>();
  files.forEach((file, index) => rank.set(file, index));
  const rankOf = (entry: TreeDir | TreeFile) => rank.get(entry) ?? Infinity;
  const dirs = new Map<string, TreeDir>([["", root]]);
  const dirOf = (path: string): TreeDir => {
    const found = dirs.get(path);
    if (found) return found;
    const slash = path.lastIndexOf("/");
    const parent = dirOf(slash < 0 ? "" : path.slice(0, slash));
    const made: TreeDir = { path, name: path.slice(slash + 1), dirs: [], files: [], entries: [], count: 0, additions: 0, deletions: 0, tone: null };
    parent.dirs.push(made);
    dirs.set(path, made);
    return made;
  };
  for (const file of files) {
    const slash = file.path.lastIndexOf("/");
    dirOf(slash < 0 ? "" : file.path.slice(0, slash)).files.push(file);
  }
  const finish = (dir: TreeDir): TreeDir => {
    dir.dirs = dir.dirs.map(finish);
    if (synced) {
      dir.dirs.sort((a, b) => rankOf(a) - rankOf(b));
      dir.files.sort((a, b) => rankOf(a) - rankOf(b));
      dir.entries = [...dir.dirs, ...dir.files].sort((a, b) => rankOf(a) - rankOf(b));
      rank.set(dir, Math.min(...dir.entries.map(rankOf)));
    } else {
      dir.dirs.sort((a, b) => collator.compare(a.name, b.name));
      dir.files.sort((a, b) => collator.compare(baseName(a.path), baseName(b.path)));
      dir.entries = [...dir.dirs, ...dir.files];
    }
    dir.count = dir.files.length;
    dir.additions = 0;
    dir.deletions = 0;
    dir.tone = null;
    const blend = (tone: Tone | null) => {
      if (tone) dir.tone = dir.tone === null || dir.tone === tone ? tone : "modified";
    };
    for (const file of dir.files) {
      dir.additions += file.additions;
      dir.deletions += file.deletions;
      blend(statusOf(file).tone);
    }
    for (const child of dir.dirs) {
      dir.count += child.count;
      dir.additions += child.additions;
      dir.deletions += child.deletions;
      blend(child.tone);
    }
    if (compact && dir.path && dir.files.length === 0 && dir.dirs.length === 1) {
      const only = dir.dirs[0]!;
      const folded = { ...only, name: `${dir.name}/${only.name}` };
      rank.set(folded, rankOf(only));
      return folded;
    }
    return dir;
  };
  return finish(root);
}

export const fileName = baseName;

/** Every file under `root`, by full path in natural order: the tree as a flat list. */
export function listFiles(root: TreeDir): TreeFile[] {
  const files: TreeFile[] = [];
  const walk = (dir: TreeDir) => {
    files.push(...dir.files);
    dir.dirs.forEach(walk);
  };
  walk(root);
  return files.sort((a, b) => collator.compare(a.path, b.path));
}

/** The folder part of a path ("" at the root). */
export const dirName = (path: string) => path.slice(0, Math.max(0, path.lastIndexOf("/")));

/** The Diff tab's "Filter files" menu. */
export interface DiffFilters {
  /** The extensions to show (".css"; "" for none); empty shows every type. */
  extensions: readonly string[];
  showDeleted: boolean;
  showViewed: boolean;
}

/** A file's extension as BB's filter menu lists it: ".css", lower case, "" for none or a dotfile. */
export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : "";
}

/**
 * The files the Diff tab's filter menu lets through, by BB's own rule: a file is
 * viewed while its revision is the one it was marked at. `viewed` null (not
 * known yet) hides nothing.
 */
export function applyFilters(
  files: readonly TreeFile[],
  filters: DiffFilters | null,
  viewed: ReadonlyMap<string, string> | null,
): readonly TreeFile[] {
  if (!filters) return files;
  const { extensions, showDeleted, showViewed } = filters;
  if (!extensions.length && showDeleted && (showViewed || !viewed)) return files;
  return files.filter(
    (file) =>
      (!extensions.length || extensions.includes(extensionOf(file.path))) &&
      (showDeleted || file.changeKind !== "deleted") &&
      (showViewed || !viewed || viewed.get(file.path) !== file.revision),
  );
}

/**
 * The folders to show open at first: breadth first, as long as the rows on screen
 * stay within `budget`, so a small change opens fully and a large one shows its
 * top levels.
 */
export function initialOpen(root: TreeDir, budget = 40): Set<string> {
  const open = new Set<string>();
  let rows = root.dirs.length + root.files.length;
  let level = root.dirs;
  while (level.length) {
    const next: TreeDir[] = [];
    for (const dir of level) {
      const adds = dir.dirs.length + dir.files.length;
      if (rows + adds > budget) return open;
      rows += adds;
      open.add(dir.path);
      next.push(...dir.dirs);
    }
    level = next;
  }
  return open;
}

/** Every folder's path. */
export function allDirs(root: TreeDir): Set<string> {
  const open = new Set<string>();
  const walk = (dir: TreeDir) => {
    for (const child of dir.dirs) {
      open.add(child.path);
      walk(child);
    }
  };
  walk(root);
  return open;
}

/** How far folders open when a scope's tree first loads. */
export type OpenDepth = "top" | "all" | "none";

/** The folders open at first: the top levels that fit (`initialOpen`), every folder, or none. */
export function openAt(root: TreeDir, depth: OpenDepth): Set<string> {
  return depth === "all" ? allDirs(root) : depth === "none" ? new Set() : initialOpen(root);
}

/** What BB's Diff tab is showing, as the Git plugin's `files` read takes it (see server.ts). */
export type Scope =
  | { target: "all" }
  | { target: "branch_committed" }
  | { target: "uncommitted" }
  | { target: "commit"; sha: string };

/**
 * The scope picker's label as a scope: "All changes", "Committed changes",
 * "Uncommitted changes", or a commit's short sha followed by its subject.
 */
export function scopeOf(label: string): Scope | null {
  const text = label.trim();
  if (/^all changes$/i.test(text)) return { target: "all" };
  if (/^committed changes$/i.test(text)) return { target: "branch_committed" };
  if (/^uncommitted changes$/i.test(text)) return { target: "uncommitted" };
  const sha = /^([0-9a-f]{7,40})(\s|$)/i.exec(text)?.[1];
  return sha ? { target: "commit", sha } : null;
}

// BB's filter splits its value at commas and runs picomatch on each part, except
// that a part with no glob syntax matches anywhere in a path, ignoring case.

/**
 * `path` as a pattern that matches only itself: glob characters escaped, a `{` as
 * `[{]` (picomatch's scan reads past an escaped one and calls the pattern plain),
 * commas (BB splits at them) as `?`.
 */
const literal = (path: string) =>
  path.replace(/[\\*?[\]}()!]/g, "\\$&").replaceAll("{", "[{]").replaceAll(",", "?");

/** `literal` undone, or null when `pattern` holds glob syntax of its own. */
function unliteral(pattern: string): string | null {
  let path = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) path += pattern[++i];
    else if (pattern.startsWith("[{]", i)) {
      path += "{";
      i += 2;
    } else if (c === "?") path += ",";
    else if ("\\*[]{}()!".includes(c)) return null;
    else path += c;
  }
  return path;
}

/** The filter for a folder: everything under it (`docs/**`). */
export const folderPattern = (path: string) => `${literal(path)}/**`;

/**
 * The filter for one file. Its plain path reads best, but a plain filter also
 * matches longer paths (`README.md` shows `docs/README.md` too), so when another
 * changed file holds the path, or the path holds glob characters, it is written
 * as `<path>/**`, which matches the path itself and nothing else.
 */
export function filePattern(path: string, files: readonly TreeFile[]): string {
  if (literal(path) === path) {
    const needle = path.toLowerCase();
    const holds = (other: string | null) => !!other && other.toLowerCase().includes(needle);
    if (!files.some((file) => file.path !== path && (holds(file.path) || holds(file.previousPath)))) return path;
  }
  return `${literal(path)}/**`;
}

/** The folder or file a filter value stands for, when it is one this tree wrote. */
export function selectedBy(
  filter: string,
  isFile: (path: string) => boolean,
): { kind: "dir" | "file"; path: string } | null {
  const value = filter.trim();
  if (!value) return null;
  if (value.endsWith("/**")) {
    const path = unliteral(value.slice(0, -3));
    return path === null ? null : { kind: isFile(path) ? "file" : "dir", path };
  }
  return literal(value) === value ? { kind: "file", path: value } : null;
}

/** The folders to open so that `path` shows. */
export function ancestors(root: TreeDir, path: string): string[] {
  const found: string[] = [];
  let dir = root;
  for (;;) {
    const child = dir.dirs.find((d) => path === d.path || path.startsWith(`${d.path}/`));
    if (!child || child.path === path) return found;
    found.push(child.path);
    dir = child;
  }
}
