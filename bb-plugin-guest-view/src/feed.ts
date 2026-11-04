// What a guest's page polls: the transcript, the header, how many guests are here and
// (when the owner allows it) everyone's prompts,
// each stamped with the revision it last changed at, so a poll that says "I have
// revision N" gets only what changed since. Pure; checked in src/feed.test.ts.
//
// Long polling, not server-sent events: Cloudflare's quick tunnels hold a stream's
// bytes back until it closes (their docs list SSE as unsupported).
import type { GuestItem } from "./model.ts";

export interface Header {
  title: string;
  status: string;
  model: string;
  effort: string;
  older: boolean;
}

/** A guest's prompt as other guests may see it. What the owner did with it is never sent. */
export interface SharedPrompt {
  id: string;
  name: string;
  text: string;
}

export interface FeedPayload {
  rev: number;
  /** The page should drop what it has: everything follows. */
  reset?: true;
  header?: Header;
  items: GuestItem[];
  /** Item ids in order; sent when it changed. Items not in it are gone. */
  order?: string[];
  /** Everyone's prompts; sent, empty, when the owner turned that off. The page lists its own prompts otherwise. */
  prompts?: SharedPrompt[];
  /** Guests connected now, this page included; null while the owner keeps the count from guests (the page then shows no number). */
  guests?: number | null;
}

export class Feed {
  rev = 0;
  /** Set by the first `update`; until then there is nothing to show. */
  ready = false;
  private readonly items = new Map<string, { key: string; item: GuestItem; rev: number }>();
  private order: string[] = [];
  private orderRev = 0;
  private header: Header | null = null;
  private headerKey = "";
  private headerRev = 0;
  private prompts: SharedPrompt[] = [];
  private promptsKey = "[]";
  private promptsRev = 0;
  private guests: number | null = 0;
  private guestsRev = 0;

  /** The ids of the items now in the thread, in order. */
  ids(): string[] {
    return [...this.order];
  }

  /** Takes a fresh read of the thread; says whether anything changed. */
  update(header: Header, items: readonly GuestItem[]): boolean {
    const next = this.rev + 1;
    let changed = !this.ready;
    this.ready = true;
    const headerKey = JSON.stringify(header);
    if (headerKey !== this.headerKey) {
      this.header = header;
      this.headerKey = headerKey;
      this.headerRev = next;
      changed = true;
    }
    const order = items.map((item) => item.id);
    if (order.length !== this.order.length || order.some((id, i) => id !== this.order[i])) {
      this.order = order;
      this.orderRev = next;
      changed = true;
    }
    const keep = new Set(order);
    for (const id of this.items.keys()) if (!keep.has(id)) this.items.delete(id);
    for (const item of items) {
      const key = JSON.stringify(item);
      if (this.items.get(item.id)?.key === key) continue;
      this.items.set(item.id, { key, item, rev: next });
      changed = true;
    }
    if (changed) this.rev = next;
    return changed;
  }

  /** Sets the prompts every guest sees (empty while the owner keeps them private); says whether it changed. */
  setPrompts(prompts: readonly SharedPrompt[]): boolean {
    const key = JSON.stringify(prompts);
    if (key === this.promptsKey) return false;
    this.prompts = prompts.map((p) => ({ ...p }));
    this.promptsKey = key;
    this.rev += 1;
    this.promptsRev = this.rev;
    return true;
  }

  /** Sets how many guests are connected (null: guests may not know); says whether it changed. */
  setGuests(count: number | null): boolean {
    if (count === this.guests) return false;
    this.guests = count;
    this.rev += 1;
    this.guestsRev = this.rev;
    return true;
  }

  /** What a page at revision `since` is missing. An unknown revision gets everything. */
  since(since: number): FeedPayload {
    const reset = !(since > 0 && since <= this.rev);
    const after = reset ? 0 : since;
    const payload: FeedPayload = { rev: this.rev, items: [] };
    if (reset) payload.reset = true;
    if (this.header && this.headerRev > after) payload.header = this.header;
    if (reset || this.orderRev > after) payload.order = [...this.order];
    for (const id of this.order) {
      const entry = this.items.get(id);
      if (entry && entry.rev > after) payload.items.push(entry.item);
    }
    if (this.promptsRev > after) payload.prompts = this.prompts.map((p) => ({ ...p }));
    if (this.guests !== 0 && (reset || this.guestsRev > after)) payload.guests = this.guests;
    return payload;
  }
}

/**
 * What a guest who may not see earlier history gets: the items that existed when
 * they joined (`skip`) are left out of the order and the items, and the header
 * says earlier messages are not shown. Pure; the feed itself is shared by all.
 */
export function hideHistory(payload: FeedPayload, skip: ReadonlySet<string>, skipPrompts: ReadonlySet<string> = new Set()): FeedPayload {
  const out: FeedPayload = { ...payload, items: payload.items.filter((item) => !skip.has(item.id)) };
  if (payload.order) out.order = payload.order.filter((id) => !skip.has(id));
  if (payload.prompts) out.prompts = payload.prompts.filter((p) => !skipPrompts.has(p.id));
  if (payload.header) out.header = { ...payload.header, older: payload.header.older || skip.size > 0 };
  return out;
}
