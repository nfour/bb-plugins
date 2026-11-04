// The pure rules of Guest View: what a guest may see of a thread, how secrets are
// masked, how a guest's text is checked, and the share's token and expiry. No I/O,
// so `node --test` checks all of it (src/model.test.ts).

// ─── Timeline → guest transcript ────────────────────────────────────────────

/** The parts of a BB timeline row this module reads. Everything else is ignored. */
export interface Row {
  id: string;
  kind: string;
  role?: string;
  text?: string;
  initiator?: string;
  workKind?: string;
  status?: string;
  summaryCount?: number;
  children?: Row[] | null;
  /** file-change rows carry the file in `change.path`; only used to count distinct files. */
  change?: { path?: string } | null;
}

/** One thing the guest sees. Text is already masked; `blocks` is parsed Markdown. */
export type GuestItem =
  | { id: string; type: "user"; blocks: Block[] }
  | { id: string; type: "assistant"; blocks: Block[] }
  | { id: string; type: "activity"; text: string; live: boolean }
  | { id: string; type: "note"; text: string };

/** How each kind of work row is counted: singular and plural phrases. */
const WORK_PHRASES: Record<string, [string, string]> = {
  command: ["ran 1 command", "ran {n} commands"],
  "file-change": ["edited 1 file", "edited {n} files"],
  "file-read": ["read 1 file", "read {n} files"],
  search: ["searched 1 time", "searched {n} times"],
  "web-search": ["searched the web once", "searched the web {n} times"],
  "web-fetch": ["fetched 1 page", "fetched {n} pages"],
  "image-generation": ["made 1 image", "made {n} images"],
  "image-view": ["viewed 1 image", "viewed {n} images"],
  "plan-steps": ["updated the plan", "updated the plan {n} times"],
  delegation: ["ran 1 subagent", "ran {n} subagents"],
  workflow: ["ran 1 workflow", "ran {n} workflows"],
  approval: ["asked for approval once", "asked for approval {n} times"],
  question: ["asked 1 question", "asked {n} questions"],
  form: ["asked 1 question", "asked {n} questions"],
  tool: ["used 1 tool", "used {n} tools"],
};
/** The order phrases appear in, so the line reads the same way every time. */
const WORK_ORDER = ["command", "file-change", "file-read", "search", "web-search", "web-fetch", "tool", "delegation", "workflow", "image-generation", "image-view", "plan-steps", "approval", "question", "form"];

/** Counts of work by kind → "Ran 3 commands, edited 2 files". Unknown kinds count as tools. */
export function summariseWork(counts: Record<string, number>): string {
  const merged: Record<string, number> = {};
  for (const [kind, n] of Object.entries(counts)) {
    if (n <= 0) continue;
    const key = kind === "form" ? "question" : WORK_PHRASES[kind] ? kind : "tool";
    merged[key] = (merged[key] ?? 0) + n;
  }
  const parts = WORK_ORDER.filter((kind) => merged[kind]).map((kind) => {
    const n = merged[kind]!;
    const [one, many] = WORK_PHRASES[kind]!;
    return n === 1 ? one : many.replace("{n}", String(n));
  });
  if (parts.length === 0) return "";
  const text = parts.join(", ");
  return text[0]!.toUpperCase() + text.slice(1);
}

/**
 * Turns timeline rows (with turn children) into what a guest sees: user and agent
 * messages, and runs of tool work collapsed into one counts-only line. Reasoning,
 * system operations, tool names, commands, paths, output and diffs never appear.
 * Messages from other agents or from BB itself become a short note with no content.
 */
export function guestTranscript(rows: readonly Row[], memo?: ParseMemo): GuestItem[] {
  const items: GuestItem[] = [];
  const used = new Set<string>();
  // A message that did not change since the last read keeps its parsed blocks.
  const blocksOf = (id: string, text: string): Block[] => {
    used.add(id);
    const known = memo?.get(id);
    if (known && known.text === text) return known.blocks;
    const cut = text.length > MAX_MESSAGE_CHARS;
    const blocks = parseMarkdown(maskSecrets(cut ? `${text.slice(0, MAX_MESSAGE_CHARS)}\n\n(This message is shortened.)` : text));
    memo?.set(id, { text, blocks });
    return blocks;
  };
  let run: { id: string; counts: Record<string, number>; files: Set<string>; live: boolean; steps: number } | null = null;

  const flush = () => {
    if (!run) return;
    const counts = { ...run.counts };
    if (run.files.size > 0) counts["file-change"] = run.files.size;
    let text = summariseWork(counts);
    if (!text && run.steps > 0) text = run.steps === 1 ? "Worked on 1 step" : `Worked on ${run.steps} steps`;
    if (text) items.push({ id: run.id, type: "activity", text, live: run.live });
    run = null;
  };

  const visit = (row: Row) => {
    if (row.kind === "turn") {
      if (row.children && row.children.length > 0) {
        for (const child of row.children) visit(child);
      } else if ((row.summaryCount ?? 0) > 0) {
        // A collapsed turn read without its children: only the step count is known.
        run ??= { id: row.id, counts: {}, files: new Set(), live: false, steps: 0 };
        run.steps += row.summaryCount ?? 0;
        if (row.status === "pending") run.live = true;
      }
      return;
    }
    if (row.kind === "work") {
      run ??= { id: row.id, counts: {}, files: new Set(), live: false, steps: 0 };
      const kind = row.workKind ?? "tool";
      if (kind === "file-change" && row.change?.path) run.files.add(row.change.path);
      else run.counts[kind] = (run.counts[kind] ?? 0) + 1;
      if (row.status === "pending") run.live = true;
      return;
    }
    if (row.kind === "conversation") {
      const text = typeof row.text === "string" ? row.text : "";
      if (row.role === "assistant") {
        if (!text.trim()) return;
        flush();
        items.push({ id: row.id, type: "assistant", blocks: blocksOf(row.id, text) });
      } else if (row.role === "user") {
        flush();
        if (row.initiator === "user") {
          if (text.trim()) items.push({ id: row.id, type: "user", blocks: blocksOf(row.id, text) });
        } else {
          items.push({ id: row.id, type: "note", text: row.initiator === "agent" ? "A message from another agent (hidden)" : "A message from BB (hidden)" });
        }
      }
      return;
    }
    // System rows (reasoning, provisioning, compaction, …) are not shown.
  };

  for (const row of rows) visit(row);
  flush();
  if (memo) for (const id of [...memo.keys()]) if (!used.has(id)) memo.delete(id);
  return items;
}

/** Longest message that is parsed; a longer one is cut, so one huge reply cannot stall the server. */
export const MAX_MESSAGE_CHARS = 64_000;

/** Parsed messages by row id, kept between reads so only changed messages are parsed again. */
export type ParseMemo = Map<string, { text: string; blocks: Block[] }>;

// ─── Secret masking ─────────────────────────────────────────────────────────

export const MASK = "[hidden]";

/** Tokens with a recognisable shape, matched anywhere in the text. */
const TOKEN_PATTERNS: RegExp[] = [
  /\bsk-(?:ant-|proj-|live-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g, // GitHub
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g, // GitLab
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, // Slack
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, // AWS access key ids
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, // Stripe
  /\bhf_[A-Za-z0-9]{30,}/g, // Hugging Face
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, // JWT
];

/** Words that say the value beside a name is a secret (the name is split at `_`, `-`, `.` and capitals first). */
const SECRET_WORDS = new Set(["secret", "secrets", "token", "tokens", "password", "passwords", "passwd", "pwd", "passphrase", "credential", "credentials", "auth", "oauth", "authorization", "apikey", "privatekey", "accesskey", "secretkey"]);
/** `<partner> key` also names a secret ("api_key", "privateKey"). */
const KEY_PARTNERS = new Set(["api", "private", "access", "secret", "signing", "encryption", "master"]);
/** A number beside one of these is a count or a limit, not a secret ("max_tokens: 100000"). */
const COUNTING_WORDS = new Set(["tokens", "limit", "max", "min", "count", "length", "size", "ttl", "timeout", "expires", "expiry", "budget", "usage", "used", "total", "per", "remaining", "window"]);
/** Values that are placeholders or types, not secrets. */
const PLAIN_VALUE = /^(?:string|number|boolean|null|undefined|true|false|none|required|optional|empty|unset|redacted|masked|bearer|basic|token|digest|process\.env\.[A-Za-z_]+|\$\{?[A-Za-z_]+\}?|<[^>]*>|x{4,}|\*{4,})\.?$/i;

function nameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function looksSecret(words: readonly string[]): boolean {
  return words.some((word, i) => SECRET_WORDS.has(word) || (word === "key" && i > 0 && KEY_PARTNERS.has(words[i - 1]!)));
}

/** A name, then `=` or `:`. Read from where a run of name characters starts, so a long run is scanned once. */
const NAME_AND_SEPARATOR = /(?<![A-Za-z0-9_.-])([*_\x60"']{0,2})([A-Za-z0-9_.-]{1,80})([*_\x60"']{0,2}[ \t]{0,4}[=:][ \t]{0,4})/g;
/** The value after it: quoted (spaces allowed) or bare, with an optional `Bearer`-style word first. */
const VALUE = /(?:"([^"\n]{4,})"|'([^'\n]{4,})'|\x60([^\x60\n]{4,})\x60|((?:(?:Bearer|Basic|Token|Digest)[ \t]+)?(?:[^\s"'\x60,;)]|,(?=\S)){4,}))/iy;

/**
 * Masks what looks like a secret: PEM blocks, known token shapes, `Bearer …`,
 * credentials in URLs, and values assigned to secret-looking names (`API_KEY=…`,
 * `"password": "…"`, `**password**: …`). Best effort: a secret with no recognisable
 * shape still shows. Reads each text once from left to right, so a long text costs a long read, no more.
 */
export function maskSecrets(text: string): string {
  let out = text.replace(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, `${MASK} (private key)`);
  for (const pattern of TOKEN_PATTERNS) out = out.replace(pattern, MASK);
  // A scheme word followed by something that looks like a credential: it has a digit or a symbol, so "Basic authentication" stays.
  out = out.replace(/\b(Bearer|Basic|Token)\s+(?=[A-Za-z0-9._~+/=-]*[0-9._~+/=-])[A-Za-z0-9._~+/=-]{12,}/g, `$1 ${MASK}`);
  out = out.replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*:\/\/)([^\s:/@]+):([^\s@/]+)@/gi, `$1$2:${MASK}@`);
  // NAME=value and NAME: value, quoted or not, where NAME looks secret.
  let result = "";
  let copied = 0;
  NAME_AND_SEPARATOR.lastIndex = 0;
  for (let found = NAME_AND_SEPARATOR.exec(out); found; found = NAME_AND_SEPARATOR.exec(out)) {
    const words = nameWords(found[2]!);
    if (!looksSecret(words)) continue; // only the name was read; its value is looked at again for names of its own
    VALUE.lastIndex = NAME_AND_SEPARATOR.lastIndex;
    const value = VALUE.exec(out);
    if (!value) continue;
    const quote = value[1] !== undefined ? '"' : value[2] !== undefined ? "'" : value[3] !== undefined ? "\x60" : "";
    let secret = value[1] ?? value[2] ?? value[3] ?? value[4] ?? "";
    let scheme = "";
    const withScheme = value[4] !== undefined ? /^(?:Bearer|Basic|Token|Digest)[ \t]+/i.exec(secret) : null;
    if (withScheme) {
      scheme = withScheme[0];
      secret = secret.slice(scheme.length);
    }
    if (secret.startsWith("[hidden") || PLAIN_VALUE.test(secret) || (!quote && secret.includes("("))) continue;
    if (/^[0-9]+$/.test(secret) && words.some((word) => COUNTING_WORDS.has(word))) continue;
    result += out.slice(copied, found.index) + `${found[1]}${found[2]}${found[3]}${quote}${scheme}${MASK}${quote}`;
    copied = VALUE.lastIndex;
    NAME_AND_SEPARATOR.lastIndex = VALUE.lastIndex;
  }
  return result + out.slice(copied);
}

// ─── Markdown → a small safe tree ───────────────────────────────────────────
//
// The page builds DOM nodes from this tree with textContent only, so nothing in a
// message is ever parsed as HTML.

export type Inline =
  | string
  | { t: "code"; text: string }
  | { t: "b" | "i" | "s"; c: Inline[] }
  | { t: "a"; href: string; c: Inline[] }
  | { t: "br" };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "code"; lang: string; text: string }
  | { t: "ul" | "ol"; start?: number; items: Inline[][] }
  | { t: "quote"; c: Block[] }
  | { t: "tbl"; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

/** Only web and mail links become links; anything else stays text. */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  return /^(?:https?:\/\/|mailto:)[^\s<>"]+$/i.test(trimmed) ? trimmed : null;
}

/** A link is `[label](address "title")`; each part is bounded, so text full of `[` is read in one pass. */
const LINK = /\[([^\]\n]{0,500})\]\(([^)\s]{1,2000})(?:\s+"[^"\n]{0,200}")?\)/y;
const MAX_LINK_CHARS = 2800;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  // Where the next "](" is (Infinity: none), looked up again only once it is behind us.
  let closeAt = -1;
  const linkAt = (from: number): number => {
    if (closeAt < from) {
      const found = text.indexOf("](", from);
      closeAt = found < 0 ? Infinity : found;
    }
    return closeAt;
  };
  const push = (node: Inline) => {
    if (buffer) out.push(buffer);
    buffer = "";
    out.push(node);
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "\\" && i + 1 < text.length && /[\\`*_~[\]()#>!|-]/.test(text[i + 1]!)) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") {
      push({ t: "br" });
      i += 1;
      continue;
    }
    if (ch === "`") {
      let after = i;
      while (text[after] === "`") after += 1;
      const run = text.slice(i, after);
      const end = text.indexOf(run, after);
      if (end > i) {
        push({ t: "code", text: text.slice(after, end).replace(/^ (.+) $/, "$1") });
        i = end + run.length;
        continue;
      }
      // A run with no match is plain text as a whole; reading it one backtick at a time would be quadratic.
      buffer += run;
      i = after;
      continue;
    }
    if (ch === "[" && linkAt(i) <= i + MAX_LINK_CHARS) {
      LINK.lastIndex = i;
      const m = LINK.exec(text);
      if (m) {
        const href = safeHref(m[2]!);
        if (href) push({ t: "a", href, c: parseInline(m[1]!) });
        else {
          if (buffer) out.push(buffer);
          buffer = "";
          out.push(...parseInline(m[1]!));
        }
        i += m[0].length;
        continue;
      }
    }
    if (ch === "h" && (text.startsWith("http://", i) || text.startsWith("https://", i)) && (i === 0 || /[\s(]/.test(text[i - 1]!))) {
      const m = /^https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/.exec(text.slice(i));
      if (m) {
        push({ t: "a", href: m[0], c: [m[0]] });
        i += m[0].length;
        continue;
      }
    }
    if (ch === "*" || ch === "_" || ch === "~") {
      const strong = text.startsWith(ch + ch, i);
      const marker = strong ? ch + ch : ch;
      if (ch !== "~" || strong) {
        const close = text.indexOf(marker, i + marker.length);
        const inner = close > i ? text.slice(i + marker.length, close) : "";
        // `_` inside words (snake_case) is not emphasis.
        const wordy = ch === "_" && ((i > 0 && /\w/.test(text[i - 1]!)) || /\w/.test(text[close + marker.length] ?? ""));
        if (close > i && inner.trim() === inner && inner.length > 0 && !inner.includes("\n\n") && !wordy) {
          const t = ch === "~" ? "s" : strong ? "b" : "i";
          push({ t, c: parseInline(inner) });
          i = close + marker.length;
          continue;
        }
      }
    }
    buffer += ch;
    i += 1;
  }
  if (buffer) out.push(buffer);
  return out;
}

/** A heading's text without trailing spaces and a closing run of `#` ("## Title ##"). */
function headingText(rest: string): string {
  let end = rest.length;
  while (end > 0 && /\s/.test(rest[end - 1]!)) end -= 1;
  let hashes = end;
  while (hashes > 0 && rest[hashes - 1] === "#") hashes -= 1;
  if (hashes < end && (hashes === 0 || /\s/.test(rest[hashes - 1]!))) {
    end = hashes;
    while (end > 0 && /\s/.test(rest[end - 1]!)) end -= 1;
  }
  return rest.slice(0, end);
}

const splitRow = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());

/** Quotes inside quotes are followed this deep; a deeper `>` is plain text (a long run of them would otherwise overflow the stack). */
const MAX_QUOTE_DEPTH = 6;

export function parseMarkdown(source: string, depth = 0): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  const isBlank = (line: string | undefined) => line === undefined || line.trim() === "";
  const startsBlock = (line: string, level: number) => /^\s{0,3}(?:```|~~~|#{1,6}\s|[-*+]\s|\d{1,9}[.)]\s|(?:-{3,}|\*{3,}|_{3,})\s*$)/.test(line) || (level < MAX_QUOTE_DEPTH && /^\s{0,3}>/.test(line));

  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const fence = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trimStart().startsWith(marker)) body.push(lines[i++]!);
      i += 1;
      blocks.push({ t: "code", lang: fence[2] ?? "", text: body.join("\n") });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ t: "h", level: heading[1]!.length, c: parseInline(headingText(heading[2]!)) });
      i += 1;
      continue;
    }
    if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i += 1;
      continue;
    }
    if (depth < MAX_QUOTE_DEPTH && /^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ""));
      blocks.push({ t: "quote", c: parseMarkdown(body.join("\n"), depth + 1) });
      continue;
    }
    const bullet = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const ordered = /\d/.test(bullet[1]!);
      const items: string[][] = [];
      while (i < lines.length) {
        const current = lines[i]!;
        const m = /^\s{0,3}([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(current);
        if (m && /\d/.test(m[1]!) === ordered) {
          items.push([m[2]!]);
          i += 1;
        } else if (!isBlank(current) && /^\s{2,}\S/.test(current) && items.length > 0) {
          items[items.length - 1]!.push(current.trim());
          i += 1;
        } else if (isBlank(current) && i + 1 < lines.length && /^\s{0,3}([-*+]|\d{1,9}[.)])\s+/.test(lines[i + 1]!)) {
          i += 1;
        } else break;
      }
      const start = ordered ? Number.parseInt(bullet[1]!, 10) : undefined;
      blocks.push({ t: ordered ? "ol" : "ul", ...(ordered && start !== 1 ? { start } : {}), items: items.map((parts) => parseInline(parts.join("\n"))) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1]!)) {
      const head = splitRow(line).map(parseInline);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.includes("|") && !isBlank(lines[i])) rows.push(splitRow(lines[i++]!).map(parseInline));
      blocks.push({ t: "tbl", head, rows });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !isBlank(lines[i]) && (para.length === 0 || !startsBlock(lines[i]!, depth))) para.push(lines[i++]!.trim());
    blocks.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return blocks;
}

// ─── Guest input ────────────────────────────────────────────────────────────

export const MAX_PROMPT_CHARS = 4000;
export const MAX_NAME_CHARS = 40;

/**
 * Plain text only: printable ASCII and line breaks. Everything else is dropped, because
 * it can smuggle in instructions the owner cannot see (zero-width and direction-control
 * characters, tag characters, look-alike letters). That also drops emoji and other alphabets.
 */
export function plainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(/[^\x20-\x7e\n]/g, "");
}

/**
 * A prompt told with its guest's name, for when the owner wants the agent to know who said it:
 * "Lydia says: <text>" for one line, the name on its own line above a longer prompt.
 */
export function attributed(name: string, text: string): string {
  const who = `${name.trim() || "Guest"} says:`;
  return text.includes("\n") ? `${who}\n${text}` : `${who} ${text}`;
}

/** Names that would pass for the owner, BB or the agent in the card and in the composer ("System says: …"). */
const RESERVED_NAMES = new Set(["owner", "system", "bb", "assistant", "agent", "claude", "admin", "administrator", "moderator", "host"]);

/** A word compared loosely: lower case, look-alike digits turned back into letters, anything else dropped. */
function looseWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/[01345@$]/g, (c) => ({ "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "@": "a", $: "s" })[c]!)
    .replace(/[^a-z]/g, "");
}

/** Whether a name (or its first word) is one a guest may not take. */
export function reservedName(name: string): boolean {
  const first = name.trim().split(/\s+/)[0] ?? "";
  return RESERVED_NAMES.has(looseWord(name)) || RESERVED_NAMES.has(looseWord(first));
}

/**
 * A guest's name: one line, at most 40 characters, no colons (so it cannot end in "says:"
 * and pass for a message) and not the owner's, the system's or the agent's. The fallback
 * is used when nothing is left.
 */
export function cleanName(name: unknown, fallback: string): string {
  if (typeof name !== "string") return fallback;
  const one = plainText(name).replace(/:/g, " ").replace(/\bsays?\b/gi, " ").replace(/\s+/g, " ").slice(0, MAX_NAME_CHARS).trim();
  return one && !reservedName(one) ? one : fallback;
}

/**
 * A cloudflared log line with what makes a guest link work taken out: the token in a
 * request path and the query after it (a guest's client id and name). The plugin log
 * then never holds a link that opens the thread.
 */
export function redactTunnelLine(line: string): string {
  return line.replace(/[A-Za-z0-9_-]{43,}/g, "<token>").replace(/\?[^\s"'\\]*/g, "?…");
}

/** A guest's prompt as plain text, or why it is refused. */
export function cleanPrompt(text: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof text !== "string") return { ok: false, error: "The prompt is missing." };
  const cleaned = plainText(text).trim();
  if (!cleaned) {
    return { ok: false, error: text.trim() ? "Only plain text can be sent: letters, numbers and the usual punctuation (no emoji or other alphabets)." : "The prompt is empty." };
  }
  if (cleaned.length > MAX_PROMPT_CHARS) return { ok: false, error: `The prompt is longer than ${MAX_PROMPT_CHARS} characters.` };
  return { ok: true, text: cleaned };
}

/**
 * Keeps a list of prompts at `cap` by dropping the oldest ones the owner has dealt with. One still
 * waiting is never dropped (the guest was told theirs was sent), so the list can stay above `cap` while many wait.
 */
export function trimSettled<T extends { status: string }>(items: T[], cap: number): void {
  while (items.length > cap) {
    const settled = items.findIndex((item) => item.status !== "pending");
    if (settled < 0) return;
    items.splice(settled, 1);
  }
}

// ─── Names ──────────────────────────────────────────────────────────────────

const ADJECTIVES = ["Quiet", "Bright", "Brave", "Calm", "Clever", "Gentle", "Happy", "Kind", "Lucky", "Merry", "Nimble", "Patient", "Polite", "Proud", "Swift", "Sunny", "Steady", "Witty", "Bold", "Curious", "Eager", "Jolly", "Mellow", "Noble"];
const ANIMALS = ["Otter", "Falcon", "Badger", "Heron", "Fox", "Lynx", "Owl", "Panda", "Robin", "Seal", "Swan", "Tiger", "Wren", "Yak", "Koala", "Marten", "Puffin", "Hare", "Moose", "Gecko", "Bison", "Crane", "Dolphin", "Raven"];

/** "Quiet Otter": `random` returns numbers in [0, 1). */
export function randomName(random: () => number): string {
  const pick = (list: string[]) => list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
  return `${pick(ADJECTIVES)} ${pick(ANIMALS)}`;
}

// ─── Share token and expiry ─────────────────────────────────────────────────

/** 32 random bytes as base64url: 43 characters, 256 bits. */
export function tokenFromBytes(bytes: Uint8Array): string {
  if (bytes.length < 32) throw new Error("A share token needs at least 32 random bytes.");
  return Buffer.from(bytes).toString("base64url");
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43,}$/;

/** Compares in time that does not depend on where the strings differ. */
export function sameToken(given: string, expected: string): boolean {
  if (!TOKEN_PATTERN.test(given) || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export interface ShareWindow {
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
}

export function shareState(share: ShareWindow, now: number): "live" | "expired" | "revoked" {
  if (share.revokedAt !== null) return "revoked";
  return now >= share.expiresAt ? "expired" : "live";
}

/** Hours a new link works unless the setting says otherwise. */
export const DEFAULT_EXPIRY_HOURS = 4;

/** Hours from the setting, kept within 1 hour and 7 days. */
export function expiryMs(hours: number): number {
  const safe = Number.isFinite(hours) ? Math.min(168, Math.max(1, hours)) : DEFAULT_EXPIRY_HOURS;
  return Math.round(safe * 3_600_000);
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

/** At most `limit` hits per key in any `windowMs`. The clock is passed in. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** Records a hit and says whether it is allowed. A refused hit is not recorded. */
  take(key: string, now: number): boolean {
    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 1000) for (const [k, list] of this.hits) if (list.every((at) => now - at >= this.windowMs)) this.hits.delete(k);
    return true;
  }
}

// ─── Header ─────────────────────────────────────────────────────────────────

/** BB's thread status as the guest reads it. */
export function workingLabel(status: string): "Working" | "Idle" | "Stopped" {
  if (status === "active" || status === "starting" || status === "pending" || status === "stopping") return "Working";
  return status === "error" ? "Stopped" : "Idle";
}
