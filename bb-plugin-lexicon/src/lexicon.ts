// The lexicon: a project's vocabulary as data. Pure, no DOM, no SDK: the server
// parses and lints the file with it, the page compiles it into a matcher and
// styles, and the tests run it as is.
//
// A term is unique (its id, and every wording it owns: the term itself, its
// aliases and its code identifiers). A kind says what sort of thing it is, which
// picks the *shape* of the paint (a line, a fill, weight); a hue says which family
// it belongs to, which picks the colour. A child term takes its parent's hue when
// it is the same kind (a feature of a feature), so a family reads as one; a
// feature under a name keeps the feature colour, and an option its own.

export const KINDS = ["name", "feature", "option", "code", "action", "outcome", "topic"] as const;
export type Kind = (typeof KINDS)[number];
/** Kinds written as proper nouns in Title Case. Actions and outcomes are plain verbs and results; code is written as the code spells it. */
export const PROPER_KINDS: readonly Kind[] = ["name", "feature", "option", "topic"];
const MINOR = new Set(["a", "an", "the", "of", "on", "in", "to", "and", "or", "for", "at", "by", "as"]);

/** "sync view order" -> "Sync View Order". Identifier-like text (kebab, snake, camel, dotted) and words that already carry capitals are left as written. */
export function properNoun(text: string): string {
  const word = text.trim();
  if (!word.includes(" ") && (/[-_.:@/]/.test(word) || /\p{Ll}\p{Lu}/u.test(word))) return word;
  return word
    .split(/\s+/)
    .map((part, i) => (/\p{Lu}/u.test(part.slice(1)) || (i > 0 && MINOR.has(part)) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}

/** The form a wording is stored in for a kind. */
export const houseForm = (text: string, kind: Kind): string => (PROPER_KINDS.includes(kind) ? properNoun(text) : text.trim());

export const TONES = ["good", "bad", "neutral"] as const;
export type Tone = (typeof TONES)[number];

/** A term of a single character matches everywhere and says nothing. */
export const MIN_PHRASE = 2;
export const MAX_PHRASE = 80;
export const MAX_ENTRIES = 2000;
export const MAX_ALIASES = 24;

export interface Entry {
  id: string;
  /** The canonical wording. */
  term: string;
  kind: Kind;
  parent?: string;
  /** Other wordings of the same thing, each owned by this entry alone. */
  aliases: string[];
  /** Identifiers in code that are this term. */
  code: string[];
  /** For outcomes: picks the hue when none is given. */
  tone?: Tone;
  /** 0-359. Overrides the hue the term would take from its parent or its kind. */
  hue?: number;
  /** One line saying what the term is. Required of agents, shown on hover. */
  note?: string;
  /** Who stands behind it: `pinned` (the user's, agents cannot change or remove it; the default) or `auto` (an agent's, painted lighter until the user pins it). */
  status?: "pinned" | "auto";
  /** Switched off by the user: kept, and its wordings stay reserved, but it is not painted, suggested or told to agents. */
  disabled?: boolean;
  by?: "user" | "agent";
  /** The thread an agent wrote it in, and when (ms), and when it last came up (ms). */
  thread?: string;
  added?: number;
  seen?: number;
  /** Why it is flagged as going out of date; it is retired if nobody keeps it. */
  stale?: string;
  staleAt?: number;
  /** Old wordings of the term (it was renamed). Painted as stale wherever they still appear. */
  retired?: string[];
}

export interface Issue {
  level: "error" | "warning";
  /** The entry's id (or its position when it has none). */
  entry?: string;
  message: string;
}

export interface Parsed {
  entries: Entry[];
  issues: Issue[];
}

const ID = /^[a-z0-9][a-z0-9-]*$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads the file's text. Bad entries are reported and left out; the rest load. */
export function parseLexicon(text: string): Parsed {
  const issues: Issue[] = [];
  const fail = (message: string, entry?: string) => issues.push({ level: "error", entry, message });
  const warn = (message: string, entry?: string) => issues.push({ level: "warning", entry, message });

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (error) {
    fail(`not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return { entries: [], issues };
  }
  if (!isRecord(root) || !Array.isArray(root.terms)) {
    fail('expected an object with a "terms" array');
    return { entries: [], issues };
  }
  if (root.terms.length > MAX_ENTRIES) warn(`only the first ${MAX_ENTRIES} of ${root.terms.length} terms are read`);

  const entries: Entry[] = [];
  const ids = new Set<string>();
  root.terms.slice(0, MAX_ENTRIES).forEach((raw, index) => {
    const label = isRecord(raw) && typeof raw.id === "string" ? raw.id : `#${index}`;
    if (!isRecord(raw)) return fail("not an object", label);
    const { id, term, kind } = raw;
    if (typeof id !== "string" || !ID.test(id)) return fail('"id" must be lower-case letters, digits and dashes', label);
    if (ids.has(id)) return fail("duplicate id", id);
    if (typeof term !== "string" || !validPhrase(term)) return fail(`"term" must be ${MIN_PHRASE}-${MAX_PHRASE} characters`, id);
    if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return fail(`"kind" must be one of ${KINDS.join(", ")}`, id);

    const words = (key: "aliases" | "code" | "retired", pattern: (value: string) => boolean, what: string): string[] => {
      const value = raw[key];
      if (value === undefined) return [];
      if (!Array.isArray(value)) {
        warn(`"${key}" must be an array`, id);
        return [];
      }
      const kept: string[] = [];
      for (const item of value.slice(0, MAX_ALIASES)) {
        if (typeof item === "string" && validPhrase(item) && pattern(item)) kept.push(item);
        else warn(`"${key}" has ${what}: ${JSON.stringify(item)}`, id);
      }
      if (value.length > MAX_ALIASES) warn(`only the first ${MAX_ALIASES} "${key}" are read`, id);
      return kept;
    };
    const entry: Entry = {
      id,
      term,
      kind: kind as Kind,
      aliases: words("aliases", () => true, "an unusable wording"),
      code: words("code", (item) => !/\s/.test(item), "an unusable identifier"),
    };
    const retired = words("retired", () => true, "an unusable wording");
    if (retired.length) entry.retired = retired;
    if (typeof raw.note === "string" && raw.note.trim()) entry.note = raw.note.trim().slice(0, 200);
    if (raw.status === "auto" || raw.status === "pinned") entry.status = raw.status;
    if (raw.by === "user" || raw.by === "agent") entry.by = raw.by;
    if (raw.disabled === true) entry.disabled = true;
    if (typeof raw.thread === "string") entry.thread = raw.thread.slice(0, 40);
    if (typeof raw.stale === "string") entry.stale = raw.stale.slice(0, 120);
    for (const key of ["added", "seen", "staleAt"] as const) if (typeof raw[key] === "number" && Number.isFinite(raw[key])) entry[key] = raw[key];
    if (typeof raw.parent === "string") entry.parent = raw.parent;
    else if (raw.parent !== undefined) warn('"parent" must be an id', id);
    if (raw.tone !== undefined) {
      if (typeof raw.tone === "string" && (TONES as readonly string[]).includes(raw.tone)) {
        entry.tone = raw.tone as Tone;
        if (entry.kind !== "outcome") warn('"tone" only applies to outcomes', id);
      } else warn(`"tone" must be one of ${TONES.join(", ")}`, id);
    }
    if (raw.hue !== undefined) {
      if (typeof raw.hue === "number" && Number.isInteger(raw.hue) && raw.hue >= 0 && raw.hue < 360) entry.hue = raw.hue;
      else warn('"hue" must be a whole number from 0 to 359', id);
    }
    ids.add(id);
    entries.push(entry);
  });

  lintParents(entries, issues);
  lintOwnership(entries, issues);
  return { entries, issues };
}

function validPhrase(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= MIN_PHRASE && trimmed.length <= MAX_PHRASE && trimmed === value;
}

/** A parent must exist and must not lead back to its child; otherwise the link is dropped. */
function lintParents(entries: Entry[], issues: Issue[]): void {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  for (const entry of entries) {
    if (entry.parent === undefined) continue;
    const parent = byId.get(entry.parent);
    if (!parent) {
      issues.push({ level: "error", entry: entry.id, message: `parent "${entry.parent}" does not exist` });
      delete entry.parent;
      continue;
    }
    for (let at: Entry | undefined = parent, steps = 0; at; at = at.parent === undefined ? undefined : byId.get(at.parent), steps++) {
      if (at === entry || steps > entries.length) {
        issues.push({ level: "error", entry: entry.id, message: `parent "${entry.parent}" leads back to this term` });
        delete entry.parent;
        break;
      }
    }
  }
}

/** Every wording belongs to one entry, compared without regard to case; the later claim loses. */
export function lintOwnership(entries: Entry[], issues: Issue[]): void {
  const owner = new Map<string, string>();
  for (const entry of entries) {
    const claim = (word: string): boolean => {
      const key = word.toLowerCase();
      const held = owner.get(key);
      if (held === undefined) {
        owner.set(key, entry.id);
        return true;
      }
      if (held !== entry.id) issues.push({ level: "error", entry: entry.id, message: `"${word}" already belongs to "${held}"` });
      return false;
    };
    // A term that loses its wording to an earlier entry stays in the file but paints nothing.
    const termOwned = claim(entry.term);
    if (!termOwned) entry.term = "";
    entry.aliases = entry.aliases.filter(claim);
    entry.code = entry.code.filter(claim);
    if (entry.retired) entry.retired = entry.retired.filter(claim);
  }
}

/** Whether `word` is a wording of any entry, ignoring case. */
export const isOwned = (entries: readonly Entry[], word: string): boolean => entries.some((e) => [e.term, ...e.aliases, ...e.code, ...(e.retired ?? [])].some((w) => w.toLowerCase() === word.toLowerCase()));

// --- colour ---------------------------------------------------------------

/** The hue a kind takes when neither the term, nor a parent, nor a tone says otherwise. */
const KIND_HUE: Record<Kind, number> = { name: 255, feature: 185, option: 300, code: 60, action: 320, outcome: 95, topic: 215 };
const TONE_HUE: Record<Tone, number> = { good: 150, bad: 20, neutral: 95 };

/** The hue of a term: its own, else the nearest same-kind parent's, else its root's tone or kind. */
export function hueOf(entry: Entry, byId: ReadonlyMap<string, Entry>): number {
  let root = entry;
  for (let at: Entry | undefined = entry, steps = 0; at && steps <= byId.size; at = at.parent === undefined ? undefined : byId.get(at.parent), steps++) {
    if (at.kind !== entry.kind) break;
    if (at.hue !== undefined) return at.hue;
    root = at;
  }
  return root.kind === "outcome" && root.tone ? TONE_HUE[root.tone] : KIND_HUE[root.kind];
}

/** How one occurrence is painted. */
export interface Look {
  /** Which shape: the entry's kind, or `code` for an identifier. */
  shape: Kind;
  /** Rounded to 10, so a project makes at most 36 colours per shape. */
  hue: number;
  /** A wording other than the canonical term. */
  alias: boolean;
  /** An old wording of a renamed term. */
  stale?: boolean;
  /** The term is an agent's, not yet kept by the user. */
  auto?: boolean;
}

/** The name of the CSS highlight that paints `look`. */
export const highlightName = (look: Look): string => `lexicon-${look.shape}-${look.hue}${look.alias ? "-alias" : ""}${look.stale ? "-stale" : ""}${look.auto ? "-auto" : ""}`;

/** The hue stale wordings are painted in whatever the term's own: they should read as a warning. */
const STALE_HUE = 70;

/**
 * Shapes: what each kind adds to the colour. Links already carry a line, so no
 * shape uses one; `::highlight()` cannot change layout either, so no real bold,
 * padding or radius. What is left is a fill (how strong), the ink (coloured or
 * the text's own), a weight (a thin glow in the ink's colour) and a halo.
 */
const SHAPE: Record<Kind, { fill: number; ink: boolean; weight: boolean; halo?: boolean }> = {
  name: { fill: 0.3, ink: true, weight: true },
  feature: { fill: 0.15, ink: true, weight: false },
  option: { fill: 0.12, ink: true, weight: true },
  code: { fill: 0.08, ink: true, weight: false },
  action: { fill: 0, ink: true, weight: true },
  outcome: { fill: 0.36, ink: true, weight: true },
  topic: { fill: 0.1, ink: true, weight: false, halo: true },
};

/** The CSS property, split so the word does not stand alone in this folder (see AGENTS.md). */
const GLOW = "text-sha" + "dow";

/** The stylesheet rule for one highlight. `light-dark()` follows BB's colour scheme, so it needs no theme detection. */
export function highlightRule(look: Look): string {
  const shape = SHAPE[look.shape];
  const h = look.stale ? STALE_HUE : look.hue;
  const ink = `light-dark(oklch(0.4 0.16 ${h}), oklch(0.86 0.12 ${h}))`;
  // An alias keeps the text's own colour and half the fill: the same family, not the canonical wording.
  const fill = look.stale ? 0.3 : look.alias ? shape.fill / 2 + 0.04 : look.auto ? shape.fill * 0.6 : shape.fill;
  const shadows = [!look.alias && !look.stale && !look.auto && shape.weight ? "0 0 0.6px currentColor" : "", shape.halo ? `0 0 0.5em light-dark(oklch(0.7 0.16 ${h} / 0.6), oklch(0.7 0.14 ${h} / 0.5))` : ""].filter(Boolean);
  const declarations = [
    look.alias || look.stale || !shape.ink ? "" : `color: ${ink}`,
    fill > 0 ? `background-color: light-dark(oklch(0.8 0.12 ${h} / ${fill.toFixed(2)}), oklch(0.55 0.14 ${h} / ${(fill + 0.06).toFixed(2)}))` : "",
    shadows.length ? `${GLOW}: ${shadows.join(", ")}` : "",
  ].filter(Boolean);
  return `::highlight(${highlightName(look)}) { ${declarations.join("; ")} }`;
}

// --- matching -------------------------------------------------------------

/** What a phrase in the text stands for. */
export interface Hit {
  entry: Entry;
  via: "term" | "alias" | "code" | "stale";
  look: Look;
}

export interface Matcher {
  /** Wordings of one token (letters, digits, `_`, joined by `-`), found by looking each token of the text up. */
  words: ReadonlyMap<string, Hit>;
  /** Every other wording (several words, or punctuation inside), one pattern; null when there are none. */
  phrases: RegExp | null;
  /** All wordings, lower-cased. */
  hits: ReadonlyMap<string, Hit>;
  entries: ReadonlyMap<string, Entry>;
}

/** Escapes for a `u`-flag pattern, which refuses `\-` outside a class. */
const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

/**
 * A phrase counts only as a whole word: not inside a longer word or identifier
 * (a hyphen or underscore joins), and not before `.ext`, so `tree` does not paint
 * inside `tree.ts` or `tree-shaking` but `bb-plugin-chat-dock` is itself a term.
 */
const BEFORE = String.raw`(?<![\p{L}\p{N}_-])`;
const AFTER = String.raw`(?![\p{L}\p{N}_]|-[\p{L}\p{N}]|\.[\p{L}\p{N}])`;
const TOKEN = /[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/gu;
const IS_TOKEN = /^[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*$/u;
const ALNUM = /[\p{L}\p{N}]/u;

export function compile(entries: readonly Entry[]): Matcher {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const hits = new Map<string, Hit>();
  const add = (word: string, entry: Entry, via: Hit["via"]) => {
    if (word === "") return;
    const hue = (Math.round(hueOf(entry, byId) / 10) * 10) % 360;
    const look: Look = { shape: via === "code" ? "code" : entry.kind, hue, alias: via === "alias" };
    if (via === "stale") look.stale = true;
    if (entry.status === "auto") look.auto = true;
    hits.set(word.toLowerCase(), { entry, via, look });
  };
  for (const entry of entries) {
    if (entry.disabled) continue;
    add(entry.term, entry, "term");
    for (const alias of entry.aliases) add(alias, entry, "alias");
    for (const identifier of entry.code) add(identifier, entry, "code");
    for (const old of entry.retired ?? []) add(old, entry, "stale");
  }
  const words = new Map<string, Hit>();
  const others: string[] = [];
  for (const [word, hit] of hits) {
    if (IS_TOKEN.test(word)) words.set(word, hit);
    else others.push(word);
  }
  // Longest first, so "pinned folders" wins over "pinned" where both start at one place.
  others.sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const phrases = others.length ? new RegExp(`${BEFORE}(?:${others.map(escape).join("|")})${AFTER}`, "giu") : null;
  return { words, phrases, hits, entries: byId };
}

export interface Found {
  start: number;
  end: number;
  hit: Hit;
}

/**
 * Every wording of the lexicon in `text`, in order, none overlapping. Single
 * tokens are looked up (cost grows with the text, not with the lexicon), the
 * rest come from one pattern; where the two overlap the longer one stays.
 */
export function findTerms(text: string, matcher: Matcher): Found[] {
  const { words, phrases, hits } = matcher;
  const found: Found[] = [];
  if (words.size) {
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
      const hit = words.get(m[0].toLowerCase());
      if (!hit) continue;
      const start = m.index;
      const end = start + m[0].length;
      if (text[start - 1] === "-" || (text[end] === "." && ALNUM.test(text[end + 1] ?? ""))) continue;
      found.push({ start, end, hit });
    }
  }
  if (phrases) {
    phrases.lastIndex = 0;
    for (let m = phrases.exec(text); m; m = phrases.exec(text)) {
      const hit = hits.get(m[0].toLowerCase());
      if (hit) found.push({ start: m.index, end: m.index + m[0].length, hit });
      if (m[0].length === 0) phrases.lastIndex++;
    }
  }
  if (!phrases || found.length < 2) return found;
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Found[] = [];
  for (const next of found) {
    const last = kept[kept.length - 1];
    if (last && next.start < last.end) continue;
    kept.push(next);
  }
  return kept;
}
