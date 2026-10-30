import { test } from "node:test";
import assert from "node:assert/strict";
import { filterMatches } from "./match.ts";

const files = ["src/a.ts", "src/deep/b.tsx", "docs/readme.md", "app/[slug]/page.tsx", ".github/ci.yml"].map((path) => ({ path, previousPath: null }));
const match = (filter: string) => {
  const found = filterMatches(files, filter);
  return found && [...found].sort();
};

test("filterMatches follows BB's path filter", () => {
  assert.equal(match(""), null);
  assert.equal(match(" , ! "), null);
  assert.deepEqual(match("src/**"), ["src/a.ts", "src/deep/b.tsx"]);
  assert.deepEqual(match("README"), ["docs/readme.md"]);
  assert.deepEqual(match("*.ts"), ["src/a.ts"]);
  assert.deepEqual(match("*.yml"), [".github/ci.yml"]);
  assert.deepEqual(match("app/\\[slug\\]/**"), ["app/[slug]/page.tsx"]);
  // No exact match: a glob matches as a prefix.
  assert.deepEqual(match("src/de*"), ["src/deep/b.tsx"]);
  assert.deepEqual(match("src/**, docs/**"), ["docs/readme.md", "src/a.ts", "src/deep/b.tsx"]);
  assert.deepEqual(match("src/**, !*.tsx"), ["src/a.ts"]);
  // An exclusion that would leave nothing is dropped.
  assert.deepEqual(match("*.ts, !*.ts"), ["src/a.ts"]);
});

test("a renamed file matches by its old path too", () => {
  const found = filterMatches([{ path: "new/x.ts", previousPath: "old/x.ts" }], "old/**");
  assert.deepEqual(found && [...found], ["new/x.ts"]);
});
