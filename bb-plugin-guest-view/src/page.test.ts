import assert from "node:assert/strict";
import { test } from "node:test";
import { Script } from "node:vm";
import { guestPage, NOT_FOUND_PAGE } from "./page.ts";

const TOKEN = "A".repeat(43);
const page = (over: Partial<Parameters<typeof guestPage>[0]> = {}) => guestPage({ token: TOKEN, shareId: "share-1", suggestedName: "Quiet Otter", nonce: "NONCE123", maxChars: 4000, ...over });

test("only the page's own style and script carry the nonce", () => {
  const html = page();
  assert.equal(html.split("NONCE123").length - 1, 2, "one style tag and one script tag");
  assert.match(html, /<style nonce="NONCE123">/);
  assert.match(html, /<script nonce="NONCE123">/);
  assert.match(html, /<script type="application\/json" id="gv-boot">/, "the data part runs nothing, so it needs no nonce");
});

test("the page has no event handler attributes or javascript: links, and loads nothing from elsewhere", () => {
  const html = page();
  const outside = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
  assert.ok(!/\son[a-z]+\s*=/i.test(outside), "no onclick= and friends");
  assert.ok(!/javascript:/i.test(outside));
  assert.ok(!/(src|href)\s*=\s*["']?(https?:)?\/\//i.test(outside), "no remote src or href");
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(html), "no remote CSS");
});

test("the boot data cannot close its tag, whatever the name", () => {
  const hostile = page({ suggestedName: '</script><script>alert(1)</script>\u2028\u2029' });
  const boot = /<script type="application\/json" id="gv-boot">([\s\S]*?)<\/script>/.exec(hostile);
  assert.ok(boot, "the data part is there and ends where it should");
  assert.ok(!boot![1]!.includes("<"), "the less-than sign is escaped");
  assert.ok(!/[\u2028\u2029]/.test(boot![1]!));
  assert.equal(JSON.parse(boot![1]!).suggestedName, '</script><script>alert(1)</script>\u2028\u2029', "and it reads back as written");
  assert.equal((hostile.match(/<script/g) ?? []).length, 2, "no extra script tags came in through the name");
});

test("the text limit reaches the textarea as a number", () => {
  assert.match(page({ maxChars: 1234 }), /maxlength="1234"/);
});

test("the page script is valid JavaScript, and the style is balanced", () => {
  const html = page();
  const script = /<script nonce="NONCE123">([\s\S]*?)<\/script>/.exec(html)![1]!;
  assert.doesNotThrow(() => new Script(script), "the script parses");
  const style = /<style nonce="NONCE123">([\s\S]*?)<\/style>/.exec(html)![1]!;
  assert.equal(style.split("{").length, style.split("}").length, "every CSS brace closes");
});

test("every id the script looks up exists in the page", () => {
  const html = page();
  const script = /<script nonce="NONCE123">([\s\S]*?)<\/script>/.exec(html)![1]!;
  const wanted = new Set([...script.matchAll(/\$\("([a-z0-9-]+)"\)/g)].map((m) => m[1]!));
  assert.ok(wanted.size > 10);
  for (const id of wanted) assert.ok(html.includes(`id="${id}"`), `#${id} is in the page`);
});

test("the not-found page says nothing about the share", () => {
  assert.match(NOT_FOUND_PAGE, /ended or does not exist/);
  assert.ok(!NOT_FOUND_PAGE.includes("<script"));
});
