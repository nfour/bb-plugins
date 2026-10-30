// Which files BB's path filter ("Search filenames") lets through, by BB's own
// rules (bb--git's `Fw`/`Mw`, bb-app 0.48): the value splits at commas; a part
// that is not a glob matches as a case-insensitive substring; a glob is
// picomatch with `dot` and `nocase`, on the base name when it has no "/"; when
// no file matches a glob exactly it matches as a prefix instead; "!" parts
// exclude, unless they would exclude everything. A file matches by its path or
// its path before a rename.
import picomatch from "picomatch";

type Test = (path: string) => boolean;

interface Matchable {
  path: string;
  previousPath: string | null;
}

const glob = (pattern: string | string[], basename: boolean): Test => picomatch(pattern, { basename, dot: true, nocase: true });

function testsFor(part: string): { exact: Test; partial: Test } {
  if (!picomatch.scan(part).isGlob) {
    const needle = part.toLowerCase();
    const test = (path: string) => path.toLowerCase().includes(needle);
    return { exact: test, partial: test };
  }
  const nested = part.includes("/");
  return {
    exact: glob(part, !nested),
    partial: nested ? glob([`${part}*`, `${part}*/**`], false) : glob(`${part}*`, true),
  };
}

const passes = (file: Matchable, test: Test) => test(file.path) || (file.previousPath !== null && test(file.previousPath));

/** The paths of the files the filter shows; null when the filter is empty and shows them all. */
export function filterMatches(files: readonly Matchable[], filter: string): Set<string> | null {
  const parts = filter
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "" && part !== "!");
  if (!parts.length) return null;
  const includes = parts
    .filter((part) => !part.startsWith("!"))
    .map((part) => {
      const { exact, partial } = testsFor(part);
      return files.some((file) => passes(file, exact)) ? exact : partial;
    });
  const kept = includes.length ? files.filter((file) => includes.some((test) => passes(file, test))) : files;
  const excludes = parts
    .filter((part) => part.startsWith("!"))
    .map((part) => testsFor(part.slice(1)).exact)
    .filter((test) => !kept.every((file) => passes(file, test)));
  return new Set(kept.filter((file) => !excludes.some((test) => passes(file, test))).map((file) => file.path));
}
