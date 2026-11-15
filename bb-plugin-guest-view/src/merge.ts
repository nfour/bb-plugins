// What a guest's page does with each poll answer: the page's copy of the feed. It is the other half of
// `Feed.since` and `hideHistory` in src/feed.ts, and must agree with them whatever order the changes came in, so it
// lives in one place that the page script embeds (as text, since the page runs in a browser with no imports) and
// the tests run (src/merge.test.ts feeds it real `since()` answers and compares with a page that read it all).
//
// Plain ES2020 and self-contained: the text between the backticks is both the page's code and the tests'.
import type { FeedPayload } from "./feed.ts";

/** The page's copy of the feed. `prompts` is null while the owner keeps them private; `guests` is unset until sent. */
export interface PageFeed {
  items: Map<string, { id: string }>;
  order: string[];
  header: unknown;
  prompts: { id: string; name: string; text: string }[] | null;
  guests: number | null | undefined;
}

export const MERGE_SOURCE = String.raw`
const emptyFeed = () => ({ items: new Map(), order: [], header: null, prompts: null, guests: undefined });
const mergeFeed = (feed, data) => {
  if (data.reset) feed.items.clear();
  for (const item of data.items || []) feed.items.set(item.id, item);
  if (data.order) {
    feed.order = data.order;
    const keep = new Set(feed.order);
    for (const id of [...feed.items.keys()]) if (!keep.has(id)) feed.items.delete(id);
  }
  if (data.header) feed.header = data.header;
  if (data.prompts) feed.prompts = data.prompts.length ? data.prompts : null;
  if (data.guests !== undefined) feed.guests = data.guests;
  return feed;
};
/** The items to draw, in order: an id the page has no item for yet is skipped. */
const drawn = (feed) => feed.order.filter((id) => feed.items.has(id)).map((id) => feed.items.get(id));
`;

const made = new Function(`${MERGE_SOURCE}\nreturn { emptyFeed, mergeFeed, drawn };`)() as {
  emptyFeed(): PageFeed;
  mergeFeed(feed: PageFeed, data: Partial<FeedPayload>): PageFeed;
  drawn(feed: PageFeed): { id: string }[];
};

export const { emptyFeed, mergeFeed, drawn } = made;
