// bb-plugin-guest-view — backend entry.
//
// Shares one thread at a time per link with someone who has no BB account. The
// owner starts a share from the thread's menu; this backend then runs a small
// HTTP server on 127.0.0.1 (src/http.ts) and a Cloudflare quick tunnel to it
// (src/tunnel.ts). The guest's page long-polls the filtered transcript
// (src/model.ts, src/feed.ts) and can suggest prompts, which wait here until the owner
// uses them (the text goes into their composer) or dismisses them from the card above
// the thread's composer. Nothing a guest writes is ever sent to the agent directly.
//
// Everything lives in memory: a share ends when it is stopped, when it expires,
// when the tunnel dies, and when the plugin stops.
import { randomBytes, randomUUID } from "node:crypto";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { emptyHeld, readHeld, type Held, type TimelineRead } from "./src/delta.ts";
import { Feed, hideHistory, type Header } from "./src/feed.ts";
import { startGuestServer, type GuestServer } from "./src/http.ts";
import {
  cleanName,
  cleanPrompt,
  DEFAULT_EXPIRY_HOURS,
  expiryMs,
  guestTranscript,
  maskSecrets,
  MAX_PROMPT_CHARS,
  randomName,
  RateLimiter,
  sameToken,
  shareState,
  tokenFromBytes,
  trimSettled,
  workingLabel,
  type ParseMemo,
  type Row,
} from "./src/model.ts";
import { CLOUDFLARED_VERSION, downloadPinned, pinnedAsset } from "./src/install.ts";
import { NoticeBatch, type Notice } from "./src/notify.ts";
import { findCloudflared, installSteps, startTunnel, stopLeftoverTunnel, type Tunnel } from "./src/tunnel.ts";
import { WaitSet } from "./src/waiters.ts";

/** Most items a guest is sent; older ones are left out and the page says so. */
const MAX_ITEMS = 300;
/** Viewers one share may have at once. */
const MAX_VIEWERS = 10;
/** Viewers one address may have at once, so one visitor cannot fill the share with page ids of their own. */
const MAX_VIEWERS_PER_IP = 5;
/** Pages one share remembers (name, what they may see); the longest gone are forgotten past this. */
const MAX_KNOWN_GUESTS = 500;
/** Polls one share lets wait at once: per page, per address, in all (a quick tunnel carries 200 requests for everyone). */
const WAIT_LIMITS = { perClient: 3, perIp: 6, total: 40 };
/** Prompts waiting for the owner, per share. */
const MAX_PENDING = 20;
/** Prompts kept per share, waiting or settled. */
const MAX_PROMPTS = 200;
/** While someone watches, the transcript is re-read this often even when no event said it changed. */
const SAFETY_REFRESH_MS = 30_000;
/** How often the viewer count is brought up to date (a page that stopped polling drops out after VIEWER_TTL_MS). */
const VIEWERS_TICK_MS = 5_000;
/** How long a first read of the thread may fail before a guest is told "nothing yet"; they ask again at once. */
const NOT_READY_WAIT_MS = 2_000;
/** How long the tunnel stays up after the last share ends, so open pages hear that it ended. */
const END_GRACE_MS = 2_000;
/** A page counts as watching for this long after its last poll. */
const VIEWER_TTL_MS = 40_000;

/** What the owner did with a prompt. Guests are never told: they only see that theirs was sent. */
export type PromptStatus = "pending" | "used" | "dismissed";

export interface OwnerPrompt {
  id: string;
  name: string;
  text: string;
  createdAt: number;
}

/** A prompt the owner has dealt with: shown in the card's History, newest first. */
export interface OwnerHistoryItem extends OwnerPrompt {
  status: "used" | "dismissed";
  resolvedAt: number;
}

/** A guest connected now, as the owner sees them. */
export interface OwnerGuest {
  id: string;
  name: string;
  /** When this connection began. */
  since: number;
}

/** What a guest learns about the other guests: nothing (only their own prompts), how many are here, or that and each other's prompts. */
export type GuestsSee = "own" | "count" | "prompts";
const guestsSee = z.enum(["own", "count", "prompts"]);

export interface OwnerState {
  threadId: string;
  /** Starting the server and tunnel. */
  starting: boolean;
  share: { url: string; createdAt: number; expiresAt: number; viewers: number; showHistory: boolean; guestsSee: GuestsSee; showModel: boolean; guests: OwnerGuest[] } | null;
  prompts: OwnerPrompt[];
  /** Prompts already used or dismissed, oldest first (the newest is last). */
  history: OwnerHistoryItem[];
  /** Why the last share failed or ended unexpectedly. */
  error: string | null;
  /** Set when cloudflared is missing. */
  install: { text: string; command: string; url: string; canInstall: boolean } | null;
}

const threadInput = z.object({ threadId: z.string().min(1).max(200) });
/** `via: "app"` is what the thread menu and the card send. Anything else (the bb CLI, an agent, another plugin) starts a share too, and the owner is told. */
const shareInput = z.object({ threadId: z.string().min(1).max(200), via: z.literal("app").optional() });
const promptInput = z.object({ threadId: z.string().min(1).max(200), promptId: z.string().min(1).max(100) });
const ownerPrompt = z.object({ id: z.string(), name: z.string(), text: z.string(), createdAt: z.number() });
const ownerHistoryItem = ownerPrompt.extend({ status: z.enum(["used", "dismissed"]), resolvedAt: z.number() });
const ownerState = z.object({
  threadId: z.string(),
  starting: z.boolean(),
  share: z
    .object({
      url: z.string(),
      createdAt: z.number(),
      expiresAt: z.number(),
      viewers: z.number(),
      showHistory: z.boolean(),
      guestsSee,
      showModel: z.boolean(),
      guests: z.array(z.object({ id: z.string(), name: z.string(), since: z.number() })),
    })
    .nullable(),
  prompts: z.array(ownerPrompt),
  history: z.array(ownerHistoryItem),
  error: z.string().nullable(),
  install: z.object({ text: z.string(), command: z.string(), url: z.string(), canInstall: z.boolean() }).nullable(),
});

export const rpcContract = defineRpcContract({
  state: { input: threadInput, output: ownerState },
  /** Threads with a live share, for the menu. */
  shared: { input: z.object({}), output: z.object({ shares: z.array(z.object({ threadId: z.string(), url: z.string(), viewers: z.number(), pending: z.number() })) }) },
  share: { input: shareInput, output: ownerState },
  stop: { input: threadInput, output: ownerState },
  /** The owner put the prompt in their composer (the page does that); it leaves the waiting list. */
  use_prompt: { input: promptInput, output: ownerState },
  dismiss_prompt: { input: promptInput, output: ownerState },
  clear_error: { input: threadInput, output: ownerState },
  /** Changes this link: when it expires (hours from now), whether guests who join later see earlier messages. */
  configure: {
    input: z.object({ threadId: z.string().min(1).max(200), expiryHours: z.number().min(1).max(168).optional(), showHistory: z.boolean().optional(), guestsSee: guestsSee.optional(), showModel: z.boolean().optional() }),
    output: ownerState,
  },
  /** Removes a guest from the link; their browser is told and cannot read or send again. */
  kick: { input: z.object({ threadId: z.string().min(1).max(200), guestId: z.string().min(1).max(100) }), output: ownerState },
  /** Downloads cloudflared into ~/.local/bin (Linux only), after the owner clicked Install. */
  install_cloudflared: { input: threadInput, output: ownerState },
});

/** The realtime channel the page listens on; the payload names the thread that changed. */
export const STATE_CHANNEL = "state";

interface GuestPrompt extends OwnerPrompt {
  status: PromptStatus;
  resolvedAt?: number;
}

interface Guest {
  name: string;
  /** The address the page last polled from (Cloudflare's view of the visitor). */
  ip: string;
  /** When the current connection began; null while not connected. */
  connectedAt: number | null;
  /** Prompts that existed when they joined, left out for them when history is off. */
  promptBaseline: Set<string> | null;
  /** Items that existed when they joined, left out for them when history is off for newcomers. */
  baseline: Set<string> | null;
  /** The history rule has been applied (on their first poll). */
  placed: boolean;
}

interface Share {
  id: string;
  threadId: string;
  token: string;
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  prompts: GuestPrompt[];
  feed: Feed;
  /** Each watching page's client id → when it last polled (Infinity while a poll waits). */
  viewers: Map<string, number>;
  /** Each page that polled, by client id, with its name and what it may see. */
  guests: Map<string, Guest>;
  /** Client ids the owner removed. */
  kicked: Set<string>;
  /** What guests learn about each other: nothing, the count, or the count and each other's prompts. */
  guestsSee: GuestsSee;
  /** Whether guests joining later see messages from before they came. */
  showHistory: boolean;
  /** Whether guests are told which model and effort the agent runs on. */
  showModel: boolean;
  /** The count the owner last saw. */
  shownViewers: string;
  /** Polls waiting for a change, limited per page, per address and in all. */
  waiters: WaitSet;
  /** Pushes to the owner's phone about guest prompts: the first at once, the rest as a summary. */
  notices: NoticeBatch;
  /** Messages already parsed, so a read parses only what changed. */
  memo: ParseMemo;
  /** The newest page of the thread as the last read left it; a refresh asks only for what changed since. */
  held: Held<Row>;
  endReason: "revoked" | "expired" | null;
  expiry: ReturnType<typeof setTimeout> | null;
  /** The read in progress; calls made meanwhile mark it dirty and share its promise. */
  refreshing: Promise<void> | null;
  dirty: boolean;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    expiryHours: {
      type: "number",
      label: "Link lifetime (hours)",
      description: "A new guest link stops working this many hours after it is made (1 to 168). The Guest View card can change it for one link.",
      default: DEFAULT_EXPIRY_HOURS,
    },
    cloudflaredPath: {
      type: "string",
      label: "cloudflared path",
      description: "Leave empty to look in PATH and ~/.local/bin.",
      default: "",
    },
  });

  const shares = new Map<string, Share>(); // by thread id
  const errors = new Map<string, string>();
  const starting = new Set<string>();
  // What outlives this run: the cloudflared process id and the threads that were shared. A run that is
  // stopped without ending its shares (a reload, a crash) leaves them here, and the next run says so
  // on the card and stops a cloudflared left behind.
  const { kv } = bb.storage;
  let keepRecord = true;
  const currentTunnel = (): Tunnel | null => tunnel;
  const record = async () => {
    if (!keepRecord) return;
    try {
      const live = [...shares.keys()];
      if (!tunnel?.pid && live.length === 0) await kv.delete("state");
      else await kv.set("state", { pid: tunnel?.pid, live });
    } catch (error) {
      bb.log.debug(`could not save the share record: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  let install: OwnerState["install"] = null;
  let server: GuestServer | null = null;
  let tunnel: Tunnel | null = null;
  let tunnelStart: Promise<{ server: GuestServer; tunnel: Tunnel }> | null = null;
  const promptLimit = new RateLimiter(5, 60_000);
  const promptLimitPerShare = new RateLimiter(30, 60_000);
  const pollLimit = new RateLimiter(120, 60_000);
  const modelNames = new Map<string, string>();
  let disposed = false;

  const publish = (threadId: string) => bb.realtime.publish(STATE_CHANNEL, { threadId });

  const stateOf = (threadId: string): OwnerState => {
    const share = shares.get(threadId);
    return {
      threadId,
      starting: starting.has(threadId),
      share:
        share && tunnel
          ? { url: `${tunnel.url}/${share.token}`, createdAt: share.createdAt, expiresAt: share.expiresAt, viewers: viewerCount(share), showHistory: share.showHistory, guestsSee: share.guestsSee, showModel: share.showModel, guests: liveGuests(share) }
          : null,
      prompts: (share?.prompts ?? []).filter((p) => p.status === "pending").map(({ id, name, text, createdAt }) => ({ id, name, text, createdAt })),
      history: (share?.prompts ?? [])
        .filter((p): p is GuestPrompt & { status: "used" | "dismissed" } => p.status !== "pending")
        .map(({ id, name, text, createdAt, status, resolvedAt }) => ({ id, name, text, createdAt, status, resolvedAt: resolvedAt ?? createdAt }))
        .sort((a, b) => a.resolvedAt - b.resolvedAt),
      error: errors.get(threadId) ?? null,
      install,
    };
  };

  function viewerCount(share: Share, now = Date.now()): number {
    let count = 0;
    for (const [client, seen] of share.viewers) {
      if (now - seen < VIEWER_TTL_MS) count += 1;
      else {
        share.viewers.delete(client);
        const guest = share.guests.get(client);
        if (guest) guest.connectedAt = null;
      }
    }
    return count;
  }
  /** Guests connected now, longest first. */
  function liveGuests(share: Share): OwnerGuest[] {
    viewerCount(share);
    const list: OwnerGuest[] = [];
    for (const [id, guest] of share.guests) {
      if (guest.connectedAt !== null && share.viewers.has(id)) list.push({ id, name: guest.name, since: guest.connectedAt });
    }
    return list.sort((a, b) => a.since - b.since);
  }
  const watched = (share: Share) => viewerCount(share) > 0;
  /** Tells the owner's page when the number of watchers moved. */
  function showViewers(share: Share) {
    const count = viewerCount(share);
    // Every guest's page shows the count (unless the owner keeps it from them), so a change reaches them too.
    if (share.feed.setGuests(share.guestsSee === "own" ? null : count)) wake(share);
    const key = `${count}:${liveGuests(share).map((g) => `${g.id}=${g.name}`).join(",")}`;
    if (key === share.shownViewers) return;
    share.shownViewers = key;
    publish(share.threadId);
  }
  function wake(share: Share) {
    share.waiters.wakeAll();
  }
  /** Everyone's prompts go to the pages only while the owner allows it; otherwise each page lists its own. */
  function promptsChanged(share: Share) {
    const list = share.guestsSee === "prompts" ? share.prompts.map((p) => ({ id: p.id, name: p.name, text: maskSecrets(p.text) })) : [];
    if (share.feed.setPrompts(list)) wake(share);
  }

  // ─── Reading the thread ──────────────────────────────────────────────────

  async function modelName(environmentId: string | null | undefined, model: string): Promise<string> {
    if (!model) return "";
    const key = `${environmentId ?? ""}:${model}`;
    const known = modelNames.get(key);
    if (known) return known;
    let name = model;
    if (environmentId) {
      try {
        const result = (await bb.sdk.providers.models({ environmentId })) as unknown as { models?: { model: string; displayName?: string }[] };
        name = result.models?.find((m) => m.model === model)?.displayName ?? model;
      } catch {
        // The id is fine as a fallback.
      }
    }
    modelNames.set(key, name);
    return name;
  }

  /**
   * Reads the thread as a guest may see it. The timeline is read as a delta against the page held (a few KB instead
   * of the whole nested page), with the content of tool rows left out (nothing here reads it). The model is only
   * looked up when guests are allowed to see it.
   */
  async function readThread(threadId: string, memo: ParseMemo, held: Held<Row>, withModel: boolean): Promise<{ header: Header; items: ReturnType<typeof guestTranscript> }> {
    const [, thread, exec] = await Promise.all([
      readHeld(held, async (afterTag) => (await bb.sdk.threads.timeline({ threadId, includeNestedRows: "true", deferContent: "true", ...(afterTag ? { afterTag } : {}) })) as unknown as TimelineRead<Row>),
      bb.sdk.threads.get({ threadId }),
      withModel ? bb.sdk.threads.defaultExecutionOptions({ threadId }).catch(() => null) : Promise.resolve(null),
    ]);
    const t = thread as unknown as { title?: string | null; titleFallback?: string | null; status: string; environmentId?: string | null };
    const options = exec as unknown as { model?: string; reasoningLevel?: string } | null;
    const all = guestTranscript(held.rows, memo);
    const items = all.slice(-MAX_ITEMS);
    const effort = options?.reasoningLevel ?? "";
    return {
      items,
      header: {
        title: maskSecrets(t.title || "Shared thread").slice(0, 200),
        status: workingLabel(t.status),
        model: await modelName(t.environmentId, options?.model ?? ""),
        effort: effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : "",
        older: all.length > items.length || held.older,
      },
    };
  }

  /** Re-reads the thread into the share's feed and wakes waiting polls when it changed. */
  function refresh(share: Share): Promise<void> {
    if (share.refreshing) {
      share.dirty = true;
      return share.refreshing;
    }
    share.refreshing = (async () => {
      try {
        do {
          share.dirty = false;
          const { header, items } = await readThread(share.threadId, share.memo, share.held, share.showModel);
          if (shares.get(share.threadId) !== share) return;
          // The model and effort only reach guests when the owner turned them on (and were only read then).
          const shown = share.showModel ? header : { ...header, model: "", effort: "" };
          if (share.feed.update(shown, items)) wake(share);
        } while (share.dirty);
      } catch (error) {
        bb.log.warn(`could not read thread ${share.threadId}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        share.refreshing = null;
      }
    })();
    return share.refreshing;
  }

  // ─── Server and tunnel ───────────────────────────────────────────────────

  const findShare = (token: string): Share | null => {
    const now = Date.now();
    for (const share of shares.values()) {
      if (sameToken(token, share.token) && shareState(share, now) === "live") return share;
    }
    return null;
  };
  const shareById = (id: string) => [...shares.values()].find((share) => share.id === id) ?? null;

  async function ensureTunnel(): Promise<{ server: GuestServer; tunnel: Tunnel }> {
    if (server && tunnel) return { server, tunnel };
    if (tunnelStart) return tunnelStart;
    tunnelStart = (async () => {
      const binary = await findCloudflared((await settings.get()).cloudflaredPath ?? "");
      if (!binary) {
        const steps = installSteps();
        install = { ...steps, canInstall: process.platform === "linux" && pinnedAsset(process.arch) !== null };
        throw new Error("cloudflared is not installed.");
      }
      install = null;
      const started = server ?? (await startGuestServer(routes, (error) => bb.log.error(`guest server: ${error instanceof Error ? error.stack : String(error)}`)));
      server = started;
      try {
        const opened = await startTunnel(binary, started.port, (line) => bb.log.debug(`cloudflared: ${line}`));
        tunnel = opened;
        bb.log.info(`tunnel up at ${opened.url} → 127.0.0.1:${started.port}`);
        void record();
        void opened.exited.then(() => {
          if (tunnel !== opened) return;
          tunnel = null;
          bb.log.warn("cloudflared exited; ending every share");
          for (const share of [...shares.values()]) {
            errors.set(share.threadId, "The Cloudflare tunnel stopped, so the guest link ended. Share again for a new link.");
            endShare(share, "revoked");
          }
        });
        return { server: started, tunnel: opened };
      } catch (error) {
        await stopServerIfUnused();
        throw error;
      }
    })();
    try {
      return await tunnelStart;
    } finally {
      tunnelStart = null;
    }
  }

  async function stopServerIfUnused() {
    if (shares.size > 0 || starting.size > 0) return;
    const t = tunnel;
    tunnel = null;
    await t?.stop();
    const s = server;
    server = null;
    await s?.close();
    if (t || s) bb.log.info("tunnel and guest server stopped");
    void record();
  }

  function endShare(share: Share, reason: "revoked" | "expired") {
    if (shares.get(share.threadId) !== share) return;
    shares.delete(share.threadId);
    if (share.expiry) clearTimeout(share.expiry);
    share.notices.cancel();
    share.revokedAt ??= Date.now();
    share.endReason = reason;
    void record();
    for (const p of share.prompts) if (p.status === "pending") p.status = "dismissed";
    promptsChanged(share);
    wake(share);
    bb.log.info(`share for ${share.threadId} ended (${reason})`);
    publish(share.threadId);
    // Give the woken polls a moment to carry "ended" out before the tunnel goes.
    setTimeout(() => void stopServerIfUnused(), END_GRACE_MS);
  }

  /** Pages from this address that are watching now. */
  function viewersFrom(share: Share, ip: string): number {
    viewerCount(share);
    let count = 0;
    for (const client of share.viewers.keys()) if (share.guests.get(client)?.ip === ip) count += 1;
    return count;
  }

  /** Makes room for one more known page by forgetting the one gone longest. False when everyone known is still here. */
  function forgetOne(share: Share): boolean {
    viewerCount(share);
    for (const [client, guest] of share.guests) {
      if (guest.connectedAt === null && !share.viewers.has(client) && !share.kicked.has(client)) {
        share.guests.delete(client);
        return true;
      }
    }
    return false;
  }

  const routes = {
    find(token: string) {
      const share = findShare(token);
      return share ? { id: share.id, suggestedName: randomName(Math.random), maxChars: MAX_PROMPT_CHARS } : null;
    },
    async poll(shareId: string, since: number, client: string, nameInput: string, ip: string, waitMs: number, closed: AbortSignal) {
      const share = shareById(shareId);
      if (!share) return { status: 404, body: { error: "This guest link has ended." } };
      if (!pollLimit.take(`${share.id}:${ip}`, Date.now())) return { status: 429, body: { error: "Too many requests.", retry: true } };
      if (share.kicked.has(client)) return { status: 200, body: { rev: share.feed.rev, items: [], ended: "kicked" } };
      if (!share.viewers.has(client)) {
        // A page that was not watching needs a free place, for the share and for its address. The page asks again later.
        if (viewerCount(share) >= MAX_VIEWERS) return { status: 429, body: { error: "Too many people are watching this thread right now. Trying again soon.", retry: true } };
        if (viewersFrom(share, ip) >= MAX_VIEWERS_PER_IP) return { status: 429, body: { error: "Too many pages are open from your connection. Close some and this one will connect.", retry: true } };
      }
      const now = Date.now();
      let guest = share.guests.get(client);
      if (!guest) {
        if (share.guests.size >= MAX_KNOWN_GUESTS && !forgetOne(share)) return { status: 429, body: { error: "This link is busy. Trying again soon.", retry: true } };
        guest = { name: "Guest", ip, connectedAt: now, baseline: null, promptBaseline: null, placed: false };
        share.guests.set(client, guest);
      }
      guest.ip = ip;
      guest.name = cleanName(nameInput, guest.name);
      if (!share.viewers.has(client)) guest.connectedAt = now;
      share.viewers.set(client, Infinity);
      showViewers(share);
      try {
        if (!share.feed.ready) await refresh(share);
        // Until the thread has been read there is nothing to show, and no way to tell what "earlier" is for a guest
        // who may not see it: say nothing yet and let them ask again, rather than fix their starting point at an empty thread.
        if (!share.feed.ready) {
          await share.waiters.wait(client, ip, Math.min(waitMs, NOT_READY_WAIT_MS), closed);
          return { status: 200, body: { rev: 0, items: [], you: guest.name } };
        }
        // The first poll after that decides what this guest may see of what came before.
        if (!guest.placed) {
          guest.placed = true;
          if (!share.showHistory) {
            guest.baseline = new Set(share.feed.ids());
            guest.promptBaseline = new Set(share.prompts.map((p) => p.id));
          }
        }
        if (since === share.feed.rev && !share.endReason && !share.kicked.has(client)) {
          const how = await share.waiters.wait(client, ip, waitMs, closed);
          if (how === "full") return { status: 429, body: { error: "This link is busy. Trying again soon.", retry: true } };
        }
        if (share.kicked.has(client)) return { status: 200, body: { rev: share.feed.rev, items: [], ended: "kicked" } };
        let payload = share.feed.since(since);
        if (guest.baseline) payload = hideHistory(payload, guest.baseline, guest.promptBaseline ?? undefined);
        // `you` is the name the owner sees for this page, which may differ from what was typed (colons, reserved names).
        return { status: 200, body: share.endReason ? { ...payload, ended: share.endReason, you: guest.name } : { ...payload, you: guest.name } };
      } finally {
        if (closed.aborted || share.kicked.has(client)) share.viewers.delete(client);
        else share.viewers.set(client, Date.now());
        showViewers(share);
      }
    },
    async submit(shareId: string, body: unknown, ip: string) {
      const share = shareById(shareId);
      if (!share || shareState(share, Date.now()) !== "live") return { status: 404, body: { error: "This guest link has ended." } };
      const input = (body ?? {}) as { name?: unknown; text?: unknown; clientId?: unknown };
      // A prompt comes from a page the owner could see and remove: one that has polled, and was not kicked.
      const clientId = typeof input.clientId === "string" ? input.clientId : "";
      if (share.kicked.has(clientId)) return { status: 403, body: { error: "The owner removed you from this thread." } };
      const guest = /^[0-9a-f]{24}$/.test(clientId) ? share.guests.get(clientId) : undefined;
      if (!guest) return { status: 400, body: { error: "Reload the page and try again." } };
      const prompt = cleanPrompt(input.text);
      if (!prompt.ok) return { status: 400, body: { error: prompt.error } };
      const now = Date.now();
      if (!promptLimit.take(`${share.id}:${ip}`, now) || !promptLimitPerShare.take(share.id, now)) {
        return { status: 429, body: { error: "Too many prompts. Wait a minute and try again." } };
      }
      if (share.prompts.filter((p) => p.status === "pending").length >= MAX_PENDING) {
        return { status: 429, body: { error: "The owner has many prompts waiting. Try again once they catch up." } };
      }
      const name = cleanName(input.name, guest.name);
      guest.name = name;
      const entry: GuestPrompt = { id: randomUUID(), name, text: prompt.text, createdAt: now, status: "pending" };
      share.prompts.push(entry);
      trimSettled(share.prompts, MAX_PROMPTS);
      promptsChanged(share);
      publish(share.threadId);
      bb.log.info(`guest prompt on ${share.threadId} from "${name}" (${prompt.text.length} chars)`);
      share.notices.add({ name, text: prompt.text });
      return { status: 201, body: { id: entry.id, text: entry.text } };
    },
  };

  /** A push notification through the Push Notifications plugin, when it is there. */
  async function push(notice: Notice, threadId: string) {
    try {
      await bb.sdk.plugins.callRpc({
        pluginId: "push-notifications",
        method: "notifications.send",
        input: { ...notice, threadId },
        outputSchema: z.object({ ok: z.literal(true) }).passthrough(),
      });
    } catch (error) {
      bb.log.debug(`no push notification: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ─── Owner actions ───────────────────────────────────────────────────────

  async function share(threadId: string, fromApp: boolean): Promise<OwnerState> {
    // Claimed before anything is awaited: two calls in flight (a double click, two BB pages) must not each make a share.
    if (shares.has(threadId) || starting.has(threadId)) return stateOf(threadId);
    starting.add(threadId);
    errors.delete(threadId);
    publish(threadId);
    try {
      const thread = (await bb.sdk.threads.get({ threadId })) as unknown as { title?: string | null; titleFallback?: string | null }; // throws for a thread that does not exist
      await ensureTunnel();
      if (disposed) throw new Error("Guest View is stopping.");
      const now = Date.now();
      const lifetime = expiryMs(Number((await settings.get()).expiryHours));
      const entry: Share = {
        id: randomUUID(),
        threadId,
        token: tokenFromBytes(randomBytes(32)),
        createdAt: now,
        expiresAt: now + lifetime,
        revokedAt: null,
        prompts: [],
        feed: new Feed(),
        viewers: new Map(),
        shownViewers: "",
        guests: new Map(),
        kicked: new Set(),
        showHistory: true,
        guestsSee: "count",
        showModel: false,
        waiters: new WaitSet(WAIT_LIMITS),
        notices: new NoticeBatch((notice) => void push(notice, threadId)),
        memo: new Map(),
        held: emptyHeld<Row>(),
        endReason: null,
        expiry: null,
        refreshing: null,
        dirty: false,
      };
      scheduleExpiry(entry, lifetime);
      shares.set(threadId, entry);
      void record();
      bb.log.info(`sharing ${threadId} until ${new Date(entry.expiresAt).toISOString()}`);
      if (!fromApp) {
        // The thread menu and the card say who they are; a share started any other way (the bb CLI, an agent that ran a
        // command, another plugin) cannot be told apart from the owner by the SDK, so it is logged and the owner is told.
        bb.log.warn(`share for ${threadId} was started from outside the Guest View menu`);
        void push({ title: "A guest link was started", body: `"${thread.title || thread.titleFallback || "A thread"}" is shared with a public link, started from outside the Guest View menu (the bb CLI, an agent or another plugin). Stop it from the card above that thread's composer if that was not you.` }, threadId);
      }
      void refresh(entry);
    } catch (error) {
      errors.set(threadId, error instanceof Error ? error.message : String(error));
      bb.log.warn(`could not share ${threadId}: ${errors.get(threadId)}`);
    } finally {
      starting.delete(threadId);
      publish(threadId);
      if (!shares.has(threadId)) void stopServerIfUnused();
    }
    return stateOf(threadId);
  }

  /** (Re)starts the timer that ends a share `ms` from now. */
  function scheduleExpiry(entry: Share, ms: number) {
    if (entry.expiry) clearTimeout(entry.expiry);
    entry.expiresAt = Date.now() + ms;
    entry.expiry = setTimeout(() => {
      const live = shares.get(entry.threadId);
      if (live?.id === entry.id) endShare(live, "expired");
    }, ms);
  }

  function findPrompt(threadId: string, promptId: string): { share: Share; prompt: GuestPrompt } {
    const live = shares.get(threadId);
    const prompt = live?.prompts.find((p) => p.id === promptId && p.status === "pending");
    if (!live || !prompt) throw new Error("That guest prompt is no longer waiting.");
    return { share: live, prompt };
  }

  function settle(share: Share, prompt: GuestPrompt, status: PromptStatus) {
    prompt.status = status;
    prompt.resolvedAt = Date.now();
    promptsChanged(share);
    publish(share.threadId);
    bb.log.info(`guest prompt on ${share.threadId} ${status}`);
  }

  bb.rpc.register(rpcContract, {
    state: async ({ threadId }) => stateOf(threadId),
    shared: async () => ({
      shares: tunnel
        ? [...shares.values()].map((live) => ({
            threadId: live.threadId,
            url: `${tunnel!.url}/${live.token}`,
            viewers: viewerCount(live),
            pending: live.prompts.filter((p) => p.status === "pending").length,
          }))
        : [],
    }),
    share: async ({ threadId, via }) => share(threadId, via === "app"),
    stop: async ({ threadId }) => {
      const live = shares.get(threadId);
      if (live) endShare(live, "revoked");
      return stateOf(threadId);
    },
    use_prompt: async ({ threadId, promptId }) => {
      const { share: live, prompt } = findPrompt(threadId, promptId);
      settle(live, prompt, "used");
      return stateOf(threadId);
    },
    dismiss_prompt: async ({ threadId, promptId }) => {
      const { share: live, prompt } = findPrompt(threadId, promptId);
      settle(live, prompt, "dismissed");
      return stateOf(threadId);
    },
    configure: async ({ threadId, expiryHours, showHistory, guestsSee: see, showModel }) => {
      const live = shares.get(threadId);
      if (!live) throw new Error("This thread is not shared.");
      if (expiryHours !== undefined) {
        scheduleExpiry(live, expiryMs(expiryHours));
        bb.log.info(`share for ${threadId} now expires ${new Date(live.expiresAt).toISOString()}`);
      }
      if (showHistory !== undefined) {
        live.showHistory = showHistory;
        bb.log.info(`share for ${threadId}: guests who join later ${showHistory ? "see" : "do not see"} earlier messages`);
      }
      if (see !== undefined) {
        live.guestsSee = see;
        showViewers(live);
        promptsChanged(live);
        bb.log.info(`share for ${threadId}: guests see ${see === "own" ? "only their own prompts" : see === "count" ? "how many guests are here" : "how many guests are here and each other's prompts"}`);
      }
      if (showModel !== undefined) {
        live.showModel = showModel;
        void refresh(live);
        bb.log.info(`share for ${threadId}: guests ${showModel ? "see" : "do not see"} the model`);
      }
      publish(threadId);
      return stateOf(threadId);
    },
    kick: async ({ threadId, guestId }) => {
      const live = shares.get(threadId);
      const guest = live?.guests.get(guestId);
      if (!live || !guest) throw new Error("That guest is no longer connected.");
      live.kicked.add(guestId);
      live.viewers.delete(guestId);
      guest.connectedAt = null;
      wake(live);
      bb.log.info(`guest "${guest.name}" removed from ${threadId}`);
      publish(threadId);
      return stateOf(threadId);
    },
    clear_error: async ({ threadId }) => {
      errors.delete(threadId);
      publish(threadId);
      return stateOf(threadId);
    },
    install_cloudflared: async ({ threadId }) => {
      await installCloudflared();
      install = null;
      errors.delete(threadId);
      publish(threadId);
      return stateOf(threadId);
    },
  });

  /** The guided install: the owner clicked Install on the card. Linux only; never runs on its own. */
  async function installCloudflared() {
    if (process.platform !== "linux") throw new Error("Install cloudflared with the command shown, then share again.");
    const { mkdir, writeFile, chmod, rename } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const asset = pinnedAsset(process.arch);
    bb.log.info(`installing cloudflared ${CLOUDFLARED_VERSION} from ${asset?.url ?? "(no build for " + process.arch + ")"}`);
    // Nothing touches the disk until the size and SHA-256 match the pinned release.
    const { bytes } = await downloadPinned(process.arch);
    const dir = join(homedir(), ".local", "bin");
    await mkdir(dir, { recursive: true });
    const target = join(dir, "cloudflared");
    await writeFile(`${target}.download`, bytes, { mode: 0o755 });
    await chmod(`${target}.download`, 0o755);
    await rename(`${target}.download`, target);
    bb.log.info(`installed cloudflared at ${target} (${bytes.length} bytes)`);
  }

  // ─── Live updates ────────────────────────────────────────────────────────

  bb.events.on("experimental_thread.events", ({ thread }) => {
    const live = shares.get(thread.id);
    if (live && watched(live)) void refresh(live);
    else if (live) live.feed.ready = false; // read again when someone opens the page
  });
  for (const event of ["thread.active", "thread.idle", "thread.failed"] as const) {
    bb.events.on(event, ({ thread }) => {
      const live = shares.get(thread.id);
      if (live && watched(live)) void refresh(live);
    });
  }
  for (const event of ["thread.archived", "thread.deleted"] as const) {
    bb.events.on(event, ({ thread }) => {
      const live = shares.get(thread.id);
      if (live) endShare(live, "revoked");
    });
  }
  // The events above carry the changes; this is the net under them, and a thread that nobody watches is not read at all.
  const refreshTimer = setInterval(() => {
    for (const live of shares.values()) if (watched(live)) void refresh(live);
  }, SAFETY_REFRESH_MS);
  const viewersTimer = setInterval(() => {
    for (const live of shares.values()) showViewers(live);
  }, VIEWERS_TICK_MS);

  // A run that was stopped without ending its shares (a reload, a crash) left a record. Say so on the cards, and stop a
  // cloudflared that outlived it: it would still hold the public address, pointing at a port nobody listens on.
  void (async () => {
    try {
      const left = await kv.get<{ pid?: number; live?: string[] }>("state");
      if (!left) return;
      await kv.delete("state");
      if (left.pid !== currentTunnel()?.pid && (await stopLeftoverTunnel(left.pid))) bb.log.warn(`stopped cloudflared ${left.pid}, left over from an earlier run`);
      for (const threadId of left.live ?? []) {
        if (shares.has(threadId) || starting.has(threadId)) continue;
        errors.set(threadId, "The guest link ended because Guest View was restarted or reloaded. Share again for a new link.");
        publish(threadId);
      }
    } catch (error) {
      bb.log.debug(`could not read the share record: ${error instanceof Error ? error.message : String(error)}`);
    }
  })();

  bb.onDispose(async () => {
    disposed = true;
    // The record keeps the threads that were shared, so the next run can tell the owner they ended.
    keepRecord = false;
    clearInterval(refreshTimer);
    clearInterval(viewersTimer);
    const open = shares.size > 0;
    for (const live of [...shares.values()]) endShare(live, "revoked");
    if (open) await new Promise((done) => setTimeout(done, 1_000));
    await stopServerIfUnused();
    bb.log.info("disposed");
  });
  bb.log.info("loaded");
}
