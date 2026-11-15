// The page's side of the feed: answers from `Feed.since` (and `hideHistory`, as the server applies it) go through the
// very code the page script runs (src/merge.ts), and a page that followed along must hold exactly what a page that
// read it all at once holds. A reset, an order change or a mismatch in what a guest may see of earlier history would show a wrong transcript
// with every other test green.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Feed, hideHistory, type FeedPayload, type Header, type SharedPrompt } from "./feed.ts";
import { drawn, emptyFeed, MERGE_SOURCE, mergeFeed, type PageFeed } from "./merge.ts";
import type { GuestItem } from "./model.ts";
import { guestPage } from "./page.ts";

const header = (status = "Idle", older = false): Header => ({ title: "T", status, model: "Opus 5.5", effort: "High", older });
const note = (id: string, text = id): GuestItem => ({ id, type: "note", text });

/** What the server sends one page: the feed's answer, cut down for a page that may not see earlier history. */
interface Seat {
  skip: Set<string> | null;
  skipPrompts: Set<string>;
}
const answer = (feed: Feed, since: number, seat: Seat): FeedPayload => {
  const payload = feed.since(since);
  return seat.skip ? hideHistory(payload, seat.skip, seat.skipPrompts) : payload;
};
const open: Seat = { skip: null, skipPrompts: new Set() };

/** A page that follows along: it remembers the revision it holds, as the page script does. */
class Page {
  feed: PageFeed = emptyFeed();
  rev = 0;
  readonly seat: Seat;
  constructor(seat: Seat) {
    this.seat = seat;
  }
  poll(feed: Feed) {
    const payload = answer(feed, this.rev, this.seat);
    mergeFeed(this.feed, payload);
    this.rev = payload.rev;
  }
}

/** What a page that came now, with nothing, would be shown. */
const fresh = (feed: Feed, seat: Seat): PageFeed => mergeFeed(emptyFeed(), answer(feed, 0, seat));
/** The parts of a page's copy that are drawn or acted on. */
const seen = (page: PageFeed) => ({ drawn: drawn(page), order: page.order, header: page.header, prompts: page.prompts, guests: page.guests });

test("the page script embeds the same text the tests run", () => {
  const html = guestPage({ token: "A".repeat(43), shareId: "s", suggestedName: "Quiet Otter", nonce: "N", maxChars: 4000 });
  assert.ok(html.includes(MERGE_SOURCE), "one source for the page and for these tests");
});

test("a first answer, a reset and an order change leave the page with the thread's items in the thread's order", () => {
  const feed = new Feed();
  feed.update(header(), [note("a"), note("b"), note("c")]);
  const page = new Page(open);
  page.poll(feed);
  assert.deepEqual(drawn(page.feed).map((i) => i.id), ["a", "b", "c"]);
  // Moved, one edited, one removed, one new.
  feed.update(header("Working"), [note("c"), note("a", "a edited"), note("d")]);
  page.poll(feed);
  assert.deepEqual(drawn(page.feed), [note("c"), note("a", "a edited"), note("d")]);
  assert.equal((page.feed.header as Header).status, "Working");
  assert.ok(!page.feed.items.has("b"), "a removed item is not kept");
});

test("a revision the feed never had (a share that started over) starts the page over", () => {
  const old = new Feed();
  for (let i = 0; i < 6; i++) old.update(header(), [note("x" + i), note("y")]);
  const page = new Page(open);
  page.poll(old);
  assert.ok(page.rev >= 6);
  // A new feed, with few revisions: the page's revision is beyond it, so the answer is a reset.
  const young = new Feed();
  young.update(header(), [note("q"), note("y", "different")]);
  page.poll(young);
  assert.deepEqual(seen(page.feed), seen(fresh(young, open)));
  assert.deepEqual(drawn(page.feed).map((i) => i.id), ["q", "y"], "nothing of the old feed is left");
});

test("a page that may not see earlier history never draws what existed when it came, however the thread changes", () => {
  const feed = new Feed();
  feed.update(header(), [note("a"), note("b")]);
  const seat: Seat = { skip: new Set(feed.ids()), skipPrompts: new Set() };
  const page = new Page(seat);
  page.poll(feed);
  assert.deepEqual(drawn(page.feed), []);
  assert.equal((page.feed.header as Header).older, true, "and it is told earlier messages are not shown");
  feed.update(header(), [note("a", "a edited"), note("b"), note("c")]);
  page.poll(feed);
  assert.deepEqual(drawn(page.feed), [note("c")], "an edit to an old item does not bring it in");
  feed.update(header("Working"), [note("c"), note("a"), note("b"), note("d")]);
  page.poll(feed);
  assert.deepEqual(drawn(page.feed).map((i) => i.id), ["c", "d"]);
  assert.equal((page.feed.header as Header).older, true, "a new header keeps saying so");
});

test("prompts shared with every guest arrive, change and go, without the ones from before a page came", () => {
  const feed = new Feed();
  feed.update(header(), []);
  const p = (id: string): SharedPrompt => ({ id, name: "Alex", text: id });
  feed.setPrompts([p("old")]);
  const seat: Seat = { skip: new Set(), skipPrompts: new Set(["old"]) };
  const page = new Page(seat);
  page.poll(feed);
  assert.equal(page.feed.prompts, null, "the one from before is left out");
  feed.setPrompts([p("old"), p("new")]);
  page.poll(feed);
  assert.deepEqual(page.feed.prompts, [p("new")]);
  feed.setPrompts([]);
  page.poll(feed);
  assert.equal(page.feed.prompts, null, "turned off: the page lists its own again");
});

test("the guest count arrives and can be withheld", () => {
  const feed = new Feed();
  feed.update(header(), []);
  const page = new Page(open);
  page.poll(feed);
  assert.equal(page.feed.guests, undefined, "nothing said yet");
  feed.setGuests(2);
  page.poll(feed);
  assert.equal(page.feed.guests, 2);
  feed.setGuests(null);
  page.poll(feed);
  assert.equal(page.feed.guests, null);
  page.poll(feed);
  assert.equal(page.feed.guests, null, "an answer that says nothing changes nothing");
});

// A seeded random run: the thread changes (items added, edited, removed, moved; the header, the shared prompts and the
// count change), pages come and go (some may not see history) and poll at random moments. After every poll the page
// must hold what a page that read it all just now holds.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`pages that follow along hold what a page that read it all holds (run ${seed})`, () => {
    const rand = random(seed);
    const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
    const feed = new Feed();
    let items: GuestItem[] = [];
    let next = 0;
    let status = "Idle";
    let prompts: SharedPrompt[] = [];
    let promptNext = 0;
    const pages: Page[] = [];
    feed.update(header(status), items);
    let polls = 0;
    for (let step = 0; step < 400; step++) {
      const roll = rand();
      if (roll < 0.2) items = [...items, note("m" + next++, "text " + step)];
      else if (roll < 0.3 && items.length) {
        const at = Math.floor(rand() * items.length);
        items = items.map((item, i) => (i === at ? note(item.id, "edited " + step) : item));
      } else if (roll < 0.36 && items.length) items = items.filter((_, i) => i !== Math.floor(rand() * items.length));
      else if (roll < 0.42 && items.length > 1) {
        const moved = [...items];
        const [one] = moved.splice(Math.floor(rand() * moved.length), 1);
        moved.splice(Math.floor(rand() * (moved.length + 1)), 0, one!);
        items = moved;
      } else if (roll < 0.47) status = pick(["Idle", "Working", "Failed"]);
      else if (roll < 0.54) {
        prompts = rand() < 0.3 ? [] : [...prompts, { id: "p" + promptNext++, name: "Alex", text: "ask " + step }].slice(-4);
        feed.setPrompts(prompts);
      } else if (roll < 0.6) feed.setGuests(pick([null, 1, 2, 3, 4]));
      else if (roll < 0.66 && pages.length < 6) {
        // A page comes; one in two may not see what is already there.
        const limited = rand() < 0.5;
        pages.push(new Page(limited ? { skip: new Set(feed.ids()), skipPrompts: new Set(prompts.map((x) => x.id)) } : open));
      }
      feed.update(header(status, false), items);
      // Some pages poll now; the rest are slow and will skip several revisions.
      for (const page of pages) {
        if (rand() < 0.4) continue;
        page.poll(feed);
        polls += 1;
        assert.deepEqual(seen(page.feed), seen(fresh(feed, page.seat)), `step ${step}: a page that followed along differs from one that read it all`);
        // The page also holds exactly the thread's items (less what it may not see), in the thread's order.
        const want = items.filter((item) => !page.seat.skip?.has(item.id));
        assert.deepEqual(drawn(page.feed), want, `step ${step}: the page does not hold the thread`);
      }
    }
    assert.ok(polls > 200, "the run polled enough to mean something");
  });
}
