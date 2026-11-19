// Holds the stylesheet to the constraints the reply format learned the hard way. Reads the source,
// and dist/app.css when a build is present.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const source = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
const SCOPE = ":where([data-timeline-row-id]) :where([data-markdown-preview])";

/** Top-level rule heads (selectors before a brace that opens at depth 0, or inside an @supports). */
function heads(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  const atStack: boolean[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") {
      const head = text.slice(start, i).trim();
      const insideAtOnly = atStack.every(Boolean);
      if (insideAtOnly && !head.startsWith("@")) out.push(head);
      atStack.push(head.startsWith("@") && !head.startsWith("@keyframes"));
      depth++;
      start = i + 1;
    } else if (c === "}") {
      atStack.pop();
      depth--;
      start = i + 1;
    } else if (c === ";") {
      start = i + 1;
    }
  }
  return out;
}

test("every outer rule is inside the timeline scope", () => {
  const outer = heads(css);
  assert.ok(outer.length >= 4);
  for (const head of outer) assert.ok(head.includes(SCOPE), `outside the scope: ${head}`);
});

test("no class selectors", () => {
  // A dot followed by a letter outside a number, such as a class name; numbers such as 0.5em are fine.
  const classes = css.match(/(^|[\s,>+~(])\.[a-zA-Z_-]/gm) ?? [];
  assert.deepEqual(classes, []);
});

test("colours come only from --ink and --canvas", () => {
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/);
  assert.doesNotMatch(css, /\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/);
  for (const mix of css.match(/color-mix\([^;]*\)/g) ?? []) {
    assert.match(mix, /^color-mix\(in oklch, var\(--ink\) (\d+%|var\(--reply-style-[a-z-]+, \d+%\)), var\(--canvas\)\)/);
  }
  assert.doesNotMatch(css, /:\s*(red|white|black|grey|gray|orange)\s*[;}]/);
});

test("no !important", () => {
  assert.doesNotMatch(css, /!important/);
});

test("the animation clips with clip-path, never overflow: clip", () => {
  assert.doesNotMatch(css, /overflow:\s*clip/);
  assert.match(css, /clip-path: inset\(0 -100vw 0 -100vw\)/);
  // and the reason stays next to it
  assert.match(source, /overflow clips both axes/);
});

test(":root appears only as an option switch", () => {
  for (const m of css.match(/:root[^)\s]*/g) ?? []) {
    assert.match(m, /^:root(:not\(\[data-reply-style-(guides|tables)="off"\]|\[data-reply-style-quote="on"\]|\[data-reply-style-elbows="off"\])/, m);
  }
  assert.doesNotMatch(css, /(^|[\s,}])html\b/);
});

test("keyframes carry the plugin's name", () => {
  for (const m of css.match(/@keyframes\s+[\w-]+/g) ?? []) assert.match(m, /@keyframes reply-style-/);
});

const dist = new URL("../dist/app.css", import.meta.url);
test("the build made no page-wide utility rules", { skip: !existsSync(dist) && "no build yet" }, () => {
  const built = readFileSync(dist, "utf8");
  assert.equal(built.match(/:where\(\[data-bb-plugin=/g)?.length ?? 0, 0);
  assert.match(built, /details::details-content/);
});

test("tables keep BB's span and paint over the guide line and quote bar", () => {
  assert.doesNotMatch(css, /--md-table-start-offset/);
  assert.match(css, new RegExp("position: rel" + "ative;\\s*background: var\\(--canvas\\)"));
});

test("reduced motion turns the transitions off", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
});
