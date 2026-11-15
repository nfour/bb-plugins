// Which icon a tree row draws, looked up VS Code's way in the vscode-icons
// subset that scripts/icons.mjs generated (src/icon-map.ts, src/icons.css): the
// file name, then the longest dotted extension (`test.ts` before `ts`), then the
// language VS Code would detect, which the generator already folded into the
// two maps. Pure, so it is tested without a browser.
import { FILE_EXTENSIONS, FILE_NAMES, FOLDER_NAMES } from "./icon-map.ts";

const lookup = (map: Record<string, string>, key: string): string | undefined => (Object.hasOwn(map, key) ? map[key] : undefined);

/** The icon for a file: a key of src/icons.css (`diff-plus-i-<key>`), `file` when none fits. */
export function fileIcon(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  // VS Code's dotenv language also takes `.env.local`, `.env.production`, ...
  const byName = lookup(FILE_NAMES, name) ?? (name.startsWith(".env.") ? lookup(FILE_NAMES, ".env") : undefined);
  if (byName) return byName;
  const parts = name.split(".");
  for (let i = 1; i < parts.length; i++) {
    const icon = lookup(FILE_EXTENSIONS, parts.slice(i).join("."));
    if (icon) return icon;
  }
  return "file";
}

/** The icon for a folder row; a folded chain (`docs/content/docs`) takes its last folder's. */
export function folderIcon(path: string, open: boolean): string {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  const icon = lookup(FOLDER_NAMES, name) ?? "folder";
  return open ? `${icon}-open` : icon;
}
