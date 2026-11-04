import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributed,
  cleanName,
  cleanPrompt,
  expiryMs,
  guestTranscript,
  MASK,
  MAX_MESSAGE_CHARS,
  maskSecrets,
  parseInline,
  parseMarkdown,
  plainText,
  randomName,
  RateLimiter,
  redactTunnelLine,
  reservedName,
  safeHref,
  sameToken,
  shareState,
  summariseWork,
  tokenFromBytes,
  trimSettled,
  workingLabel,
  type ParseMemo,
  type Row,
} from "./model.ts";

test("summariseWork counts kinds in a set order and capitalises", () => {
  assert.equal(summariseWork({ "file-change": 2, command: 3 }), "Ran 3 commands, edited 2 files");
  assert.equal(summariseWork({ command: 1 }), "Ran 1 command");
  assert.equal(summariseWork({ "web-search": 1, "file-read": 4 }), "Read 4 files, searched the web once");
  assert.equal(summariseWork({ "something-new": 2, tool: 1 }), "Used 3 tools");
  assert.equal(summariseWork({ form: 1, question: 1 }), "Asked 2 questions");
  assert.equal(summariseWork({}), "");
});

const user = (id: string, text: string, initiator = "user"): Row => ({ id, kind: "conversation", role: "user", text, initiator });
const assistant = (id: string, text: string): Row => ({ id, kind: "conversation", role: "assistant", text });
const work = (id: string, workKind: string, extra: Partial<Row> = {}): Row => ({ id, kind: "work", workKind, status: "completed", ...extra });

test("guestTranscript keeps messages and turns tool work into counts", () => {
  const rows: Row[] = [
    user("u1", "Fix the bug"),
    { id: "op", kind: "system", text: "Provisioned" },
    {
      id: "t1",
      kind: "turn",
      status: "completed",
      summaryCount: 4,
      children: [
        work("c1", "command", { text: "rm -rf /secret/path" } as Partial<Row>),
        { id: "r1", kind: "system", text: "thinking about secrets" },
        work("c2", "command"),
        work("f1", "file-change", { change: { path: "/a.ts" } }),
        work("f2", "file-change", { change: { path: "/a.ts" } }),
        work("f3", "file-change", { change: { path: "/b.ts" } }),
        assistant("a1", "Looking at it."),
        work("s1", "search"),
      ],
    },
    assistant("a2", "Done."),
  ];
  const items = guestTranscript(rows);
  assert.deepEqual(
    items.map((item) => [item.type, item.type === "activity" || item.type === "note" ? item.text : item.id]),
    [
      ["user", "u1"],
      ["activity", "Ran 2 commands, edited 2 files"],
      ["assistant", "a1"],
      ["activity", "Searched 1 time"],
      ["assistant", "a2"],
    ],
  );
  const json = JSON.stringify(items);
  assert.ok(!json.includes("rm -rf"), "commands never leave");
  assert.ok(!json.includes("/a.ts"), "paths never leave");
  assert.ok(!json.includes("thinking"), "reasoning never leaves");
});

test("guestTranscript marks live work and hides other agents' messages", () => {
  const items = guestTranscript([
    user("u1", "[bb message from thread:thr_x] private", "agent"),
    user("u2", "system note", "system"),
    work("c1", "command", { status: "pending" }),
  ]);
  assert.equal(items[0]!.type, "note");
  assert.ok(!JSON.stringify(items).includes("private"));
  assert.equal(items[1]!.type, "note");
  assert.deepEqual(items[2], { id: "c1", type: "activity", text: "Ran 1 command", live: true });
});

test("guestTranscript counts collapsed turns by their step count", () => {
  const items = guestTranscript([{ id: "t", kind: "turn", status: "completed", summaryCount: 3, children: null }]);
  assert.deepEqual(items, [{ id: "t", type: "activity", text: "Worked on 3 steps", live: false }]);
});

/** Two pieces joined at run time: the source never holds a whole token-shaped string, which GitHub's push protection would block. */
const join = (head: string, tail: string) => head + tail;

test("guestTranscript masks secrets in messages", () => {
  const items = guestTranscript([assistant("a", "Use OPENAI_API_KEY=" + join("sk-", "abcdefghijklmnopqrstuvwxyz123456"))]);
  const json = JSON.stringify(items);
  assert.ok(!json.includes("sk-abc"));
  assert.ok(json.includes(MASK));
});

test("maskSecrets hides common secret shapes", () => {
  const cases: [string, string][] = [
    ["key " + join("sk-ant-", "api03-abcdefghijklmnopqrstuvwx") + " here", "sk-ant"],
    [join("ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"), "ghp_"],
    [join("github_pat_", "11ABCDEFG0123456789_abcdefghijk"), "github_pat_"],
    [join("AKIA", "IOSFODNN7EXAMPLE"), "AKIA"],
    [join("xoxb-", "123456789012-abcdefghij"), "xoxb-"],
    ["Authorization: Bearer abc.def.ghijklmnopqrstu", "abc.def"],
    ["postgres://admin:hunter22@db.local/x", "hunter22"],
    ["export DATABASE_PASSWORD=correcthorse", "correcthorse"],
    ['{"client_secret": "s3cr3tvalue"}', "s3cr3tvalue"],
    [join("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"), "eyJhbGci"],
    [join("-----BEGIN OPENSSH ", "PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAA\n-----END OPENSSH ") + "PRIVATE KEY-----", "b3BlbnNz"],
    ["GITHUB_TOKEN: abcdef123456", "abcdef123456"],
  ];
  for (const [input, leak] of cases) {
    const masked = maskSecrets(input);
    assert.ok(!masked.includes(leak), `${input} → ${masked}`);
    assert.ok(masked.includes(MASK), `${input} → ${masked}`);
  }
});

test("maskSecrets leaves ordinary prose and code alone", () => {
  for (const text of [
    "The token is refreshed every hour.",
    "interface Auth { token: string }",
    "const password = process.env.DB_PASSWORD",
    "Set the API key in settings.",
    "Ran 3 commands",
    "skip-this-flag and sk-short",
  ]) {
    assert.equal(maskSecrets(text), text);
  }
});

test("parseMarkdown handles the common blocks", () => {
  const blocks = parseMarkdown("# Title\n\nSome **bold** and `code`.\n\n```ts\nconst a = 1;\n```\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n| a | b |\n| --- | --- |\n| 1 | 2 |");
  assert.deepEqual(
    blocks.map((part) => part.t),
    ["h", "p", "code", "ul", "ol", "quote", "hr", "tbl"],
  );
  assert.deepEqual(blocks[1], { t: "p", c: ["Some ", { t: "b", c: ["bold"] }, " and ", { t: "code", text: "code" }, "."] });
  assert.deepEqual(blocks[2], { t: "code", lang: "ts", text: "const a = 1;" });
  assert.deepEqual(blocks[7], { t: "tbl", head: [["a"], ["b"]], rows: [[["1"], ["2"]]] });
});

test("parseMarkdown keeps an unclosed fence open (streaming)", () => {
  assert.deepEqual(parseMarkdown("```js\nlet x"), [{ t: "code", lang: "js", text: "let x" }]);
});

test("parseInline only links web and mail addresses", () => {
  assert.ok(!JSON.stringify(parseInline("[x](javascript:alert(1))")).includes('"t":"a"'));
  assert.deepEqual(parseInline("[site](https://example.com)"), [{ t: "a", href: "https://example.com", c: ["site"] }]);
  assert.deepEqual(parseInline("see https://example.com/a."), ["see ", { t: "a", href: "https://example.com/a", c: ["https://example.com/a"] }, "."]);
  assert.equal(safeHref("data:text/html,x"), null);
  assert.equal(safeHref("mailto:a@b.c"), "mailto:a@b.c");
});

test("parseInline leaves snake_case and raw HTML as text", () => {
  assert.deepEqual(parseInline("snake_case_name"), ["snake_case_name"]);
  assert.deepEqual(parseInline("<img src=x onerror=alert(1)>"), ["<img src=x onerror=alert(1)>"]);
});

test("cleanName and cleanPrompt bound what a guest sends", () => {
  assert.equal(cleanName("  Alex \u0007 ", "Quiet Otter"), "Alex");
  assert.equal(cleanName("", "Quiet Otter"), "Quiet Otter");
  assert.equal(cleanName(42, "Quiet Otter"), "Quiet Otter");
  assert.equal(cleanName("a".repeat(100), "x").length, 40);
  assert.equal(cleanName("two\nlines", "x"), "two lines");
  assert.deepEqual(cleanPrompt("  hi  "), { ok: true, text: "hi" });
  assert.equal(cleanPrompt("   ").ok, false);
  assert.equal(cleanPrompt("x".repeat(4001)).ok, false);
  assert.equal(cleanPrompt(null).ok, false);
});

test("plainText keeps printable ASCII and line breaks, and nothing else", () => {
  assert.equal(plainText("if (a < b && c > d) { x = `y`; } // $HOME \\ | ~"), "if (a < b && c > d) { x = `y`; } // $HOME \\ | ~");
  assert.equal(plainText("one\r\ntwo\rthree\tfour"), "one\ntwo\nthree four");
  // Zero-width, direction-control, tag characters, accents, other scripts and emoji go.
  assert.equal(plainText("a\u200bb\u202ec\u2066d"), "abcd");
  assert.equal(plainText("hi\u{e0049}\u{e0067}\u{e006e}there"), "hithere");
  assert.equal(plainText("caf\u00e9 \u540d\u524d \u{1f600}ok"), "caf  ok");
  assert.equal(plainText("\u0000\u001b[31mred\u007f"), "[31mred");
});

test("cleanPrompt refuses a prompt with nothing sendable and says why", () => {
  assert.deepEqual(cleanPrompt("hello \u{1f600} <b>world</b>"), { ok: true, text: "hello  <b>world</b>" });
  const emoji = cleanPrompt("\u{1f600}\u{1f600}");
  assert.equal(emoji.ok, false);
  assert.match(emoji.ok ? "" : emoji.error, /plain text/);
  const blank = cleanPrompt("  \n ");
  assert.equal(blank.ok ? "" : blank.error, "The prompt is empty.");
});

test("cleanName keeps the same plain-text rule", () => {
  assert.equal(cleanName("Jos\u00e9 \u{1f600}", "Quiet Otter"), "Jos");
  assert.equal(cleanName("\u540d\u524d", "Quiet Otter"), "Quiet Otter");
});

test("randomName picks an adjective and an animal", () => {
  assert.equal(randomName(() => 0), "Quiet Otter");
  assert.match(randomName(() => 0.9999), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
});

test("tokens are long and compared exactly", () => {
  const token = tokenFromBytes(new Uint8Array(32).fill(7));
  assert.equal(token.length, 43);
  assert.ok(sameToken(token, token));
  assert.ok(!sameToken(token.slice(0, -1) + "A", token));
  assert.ok(!sameToken("short", token));
  assert.ok(!sameToken(token + "/", token));
  assert.throws(() => tokenFromBytes(new Uint8Array(8)));
});

test("shares expire and can be revoked", () => {
  const share = { createdAt: 0, expiresAt: 1000, revokedAt: null };
  assert.equal(shareState(share, 999), "live");
  assert.equal(shareState(share, 1000), "expired");
  assert.equal(shareState({ ...share, revokedAt: 5 }, 10), "revoked");
  assert.equal(expiryMs(24), 86_400_000);
  assert.equal(expiryMs(0), 3_600_000);
  assert.equal(expiryMs(10_000), 168 * 3_600_000);
  assert.equal(expiryMs(Number.NaN), 4 * 3_600_000);
});

test("RateLimiter allows a burst then refuses until the window passes", () => {
  const limiter = new RateLimiter(2, 1000);
  assert.ok(limiter.take("ip", 0));
  assert.ok(limiter.take("ip", 10));
  assert.ok(!limiter.take("ip", 20));
  assert.ok(limiter.take("other", 20));
  assert.ok(limiter.take("ip", 1001));
});

test("attributed puts the guest's name in front of the prompt", () => {
  assert.equal(attributed("Lydia", "rename the button"), "Lydia says: rename the button");
  assert.equal(attributed("Lydia", "first line\nsecond line"), "Lydia says:\nfirst line\nsecond line");
  assert.equal(attributed("  ", "hi"), "Guest says: hi");
});

test("header labels", () => {
  assert.equal(workingLabel("active"), "Working");
  assert.equal(workingLabel("idle"), "Idle");
  assert.equal(workingLabel("error"), "Stopped");
});

// ─── Review fixes ───────────────────────────────────────────────────────────

/** Runs `fn` and fails when it takes longer than `ms`: a guard against text that makes a parser quadratic. */
function within(ms: number, fn: () => unknown) {
  const start = performance.now();
  fn();
  const took = performance.now() - start;
  assert.ok(took < ms, `took ${Math.round(took)}ms, allowed ${ms}ms`);
}

test("parseInline reads text full of brackets, backticks and links in one pass", () => {
  within(250, () => parseInline("[".repeat(60_000)));
  within(250, () => parseInline("[x".repeat(30_000)));
  within(250, () => parseInline("[a](".repeat(15_000)));
  within(250, () => parseInline("`".repeat(60_000)));
  within(250, () => parseInline("`a".repeat(30_000)));
  // The links that are real still are.
  assert.deepEqual(parseInline("see [docs](https://example.com/a) now"), ["see ", { t: "a", href: "https://example.com/a", c: ["docs"] }, " now"]);
  assert.deepEqual(parseInline("```not closed"), ["```not closed"]);
});

test("parseMarkdown keeps headings, quotes and long runs cheap", () => {
  within(250, () => parseMarkdown("# a " + "#".repeat(60_000) + " x"));
  within(250, () => parseMarkdown("# " + " ".repeat(60_000) + "x"));
  assert.deepEqual(parseMarkdown("## Title ##")[0], { t: "h", level: 2, c: ["Title"] });
  assert.deepEqual(parseMarkdown("# C#")[0], { t: "h", level: 1, c: ["C#"] });
  // A very deep run of quote marks must not overflow the stack and stall every guest's feed.
  let blocks: ReturnType<typeof parseMarkdown> = [];
  assert.doesNotThrow(() => (blocks = parseMarkdown(">".repeat(40_000) + " x")));
  assert.equal(blocks[0]?.t, "quote");
  assert.doesNotThrow(() => parseMarkdown("> ".repeat(40_000) + "x"));
  assert.deepEqual(parseMarkdown("> a\n> > b")[0], { t: "quote", c: [{ t: "p", c: ["a"] }, { t: "quote", c: [{ t: "p", c: ["b"] }] }] });
});

test("guestTranscript cuts a huge message, and reuses what did not change", () => {
  const huge = "word ".repeat(40_000);
  const [item] = guestTranscript([assistant("a1", huge)]);
  const text = JSON.stringify(item);
  assert.ok(text.length < MAX_MESSAGE_CHARS + 2_000, "the message is cut");
  assert.ok(text.includes("This message is shortened"));

  const memo: ParseMemo = new Map();
  const first = guestTranscript([assistant("a1", "one"), assistant("a2", "two")], memo);
  const again = guestTranscript([assistant("a1", "one"), assistant("a2", "two changed")], memo);
  assert.strictEqual((again[0] as { blocks: unknown }).blocks, (first[0] as { blocks: unknown }).blocks, "an unchanged message keeps its parsed blocks");
  assert.notStrictEqual((again[1] as { blocks: unknown }).blocks, (first[1] as { blocks: unknown }).blocks);
  guestTranscript([assistant("a1", "one")], memo);
  assert.deepEqual([...memo.keys()], ["a1"], "messages that left the thread leave the memo");
});

test("maskSecrets catches quoted values with spaces, emphasis and short values", () => {
  assert.equal(maskSecrets("PASSWORD = 'abc def'"), `PASSWORD = '${MASK}'`);
  assert.equal(maskSecrets("password=p@ss,word"), `password=${MASK}`);
  assert.equal(maskSecrets("**password**: hunter22hunter"), `**password**: ${MASK}`);
  assert.equal(maskSecrets("token=abc12"), `token=${MASK}`);
  assert.equal(maskSecrets("client_secret = 'x y z w'"), `client_secret = '${MASK}'`);
  assert.equal(maskSecrets('{"api_key":"abcd1234","user":"bob"}'), `{"api_key":"${MASK}","user":"bob"}`);
  assert.equal(maskSecrets("accessToken: 'abcd1234'"), `accessToken: '${MASK}'`);
  // A name that is not secret does not hide a secret that follows it.
  assert.equal(maskSecrets("Config: API_KEY=abcd1234efgh"), `Config: API_KEY=${MASK}`);
  assert.equal(maskSecrets("note: password=hunter2hunter2"), `note: password=${MASK}`);
  // A scheme word does not stand in for the credential after it.
  assert.equal(maskSecrets("Authorization: Bearer abc123xyz9"), `Authorization: Bearer ${MASK}`);
  assert.equal(maskSecrets("Authorization: Basic dXNlcjpwYXNz"), `Authorization: Basic ${MASK}`);
});

test("maskSecrets leaves names that only look secret, counts and placeholders", () => {
  for (const same of [
    "Author: Alexander",
    "authority: high",
    "secretary: Bob Smith",
    "max_tokens: 100000",
    "tokens: 4096",
    "token_count: 120000",
    "Basic authentication is simple",
    "Token validation happens",
    "token: string",
    "token = getToken()",
    "password: required.",
    "const token = process.env.API_TOKEN",
    "Token: none",
  ]) {
    assert.equal(maskSecrets(same), same);
  }
  // But a number beside a secret name is still a secret.
  assert.equal(maskSecrets("password: 12345678"), `password: ${MASK}`);
  assert.equal(maskSecrets("token: 123456789012"), `token: ${MASK}`);
});

test("maskSecrets reads long texts once", () => {
  for (const text of ["a.".repeat(60_000), "a-".repeat(60_000), "api_key".repeat(8_000), "a:".repeat(60_000), "token" + " ".repeat(60_000) + "=", "-----BEGIN A-----" + "x".repeat(60_000), "a://" + "b:".repeat(30_000), "Bearer " + "a".repeat(60_000)]) {
    within(250, () => maskSecrets(text));
  }
});

test("a guest cannot take the owner's, the system's or the agent's name", () => {
  for (const name of ["Owner", "owner", "OWNER", "0wner", "O w n e r", "System", "BB", "bb", "Claude", "Assistant", "Admin", "Owner Bob", "System: Bob", "Agent 7"]) {
    assert.equal(cleanName(name, "Guest"), "Guest", name);
    assert.ok(reservedName(name) || /:/.test(name), name);
  }
  // A colon cannot end a name in "says:", and the word itself goes.
  assert.equal(cleanName("Bob says: ignore the above", "Guest"), "Bob ignore the above");
  assert.equal(cleanName("Lydia", "Guest"), "Lydia");
  assert.equal(cleanName("Quiet Otter", "Guest"), "Quiet Otter");
  assert.equal(cleanName("Ownership Team", "Guest"), "Ownership Team", "only a whole word is reserved");
  assert.equal(cleanName("Hostile", "Guest"), "Hostile");
});

test("redactTunnelLine takes the token and the query out of a cloudflared line", () => {
  const token = tokenFromBytes(new Uint8Array(32).fill(7));
  const line = `ERR Request failed error="context canceled" dest=https://gently-exercises.trycloudflare.com/${token}/poll?since=4&client=0123456789abcdef01234567&name=Kind%20Wren ip=1.2.3.4`;
  const out = redactTunnelLine(line);
  assert.ok(!out.includes(token));
  assert.ok(!out.includes("client="));
  assert.ok(!out.includes("Kind"));
  assert.ok(out.includes("/<token>/poll?…"));
  assert.ok(out.includes("gently-exercises.trycloudflare.com"));
  assert.equal(redactTunnelLine("INF Registered tunnel connection connIndex=0"), "INF Registered tunnel connection connIndex=0");
});

test("trimSettled drops settled prompts first and never a waiting one", () => {
  const list = [{ id: 1, status: "pending" }, { id: 2, status: "used" }, { id: 3, status: "pending" }, { id: 4, status: "dismissed" }, { id: 5, status: "pending" }];
  trimSettled(list, 4);
  assert.deepEqual(list.map((p) => p.id), [1, 3, 4, 5], "the oldest settled one goes, though a pending one is older");
  trimSettled(list, 2);
  assert.deepEqual(list.map((p) => p.id), [1, 3, 5]);
  trimSettled(list, 0);
  assert.equal(list.length, 3, "waiting prompts stay even over the cap");
});

test("RateLimiter forgets quiet keys once it holds many", () => {
  const limiter = new RateLimiter(1, 1_000);
  for (let i = 0; i < 1_200; i += 1) assert.ok(limiter.take(`k${i}`, 0));
  assert.ok(!limiter.take("k0", 500), "still inside the window");
  assert.ok(limiter.take("k0", 2_000), "a key is allowed again after its window");
  assert.ok(limiter.take("fresh", 2_000));
  assert.ok((limiter as unknown as { hits: Map<string, number[]> }).hits.size <= 3, "keys past their window were dropped");
});
