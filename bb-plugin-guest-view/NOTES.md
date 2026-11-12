# Guest View: design notes

For whoever changes the plugin next. The README says what it does for a user; this says why it is built the way it is and what bites. Decisions made while building it are in the FINDINGS.md of the thread that owns it.

## The flow

**Share with guest** (thread action, `src/ThreadMenu.ts`, settings group, order 103, after the other plugins' entries) calls the `share` RPC. The backend (`server.ts`) starts one Node HTTP server on `127.0.0.1` and a random port (`src/http.ts`) and one Cloudflare quick tunnel to it (`src/tunnel.ts`, `cloudflared tunnel --url`). Every share on the machine uses that one server and tunnel; they stop when the last share ends (after a 2 s grace so open pages hear "ended"). BB Connect was ruled out: its links need the owner's getbb.app session.

The guest server answers three routes under `/<token>`: the page, `poll`, `prompts`. A wrong token, any other path or method, and an ended share all get the same 404. The token is 32 random bytes (base64url, 43 characters) compared in constant time (`sameToken`). BB's own API is never reachable through it.

A share ends on Stop sharing, expiry (`expiryHours`, default 4, 1 to 168), archive or delete of the thread, the tunnel exiting, or dispose. All share state is in memory. Only the cloudflared pid and the shared thread ids go to kv `state`, so the next load can tell the owner "the guest link ended because Guest View was restarted or reloaded" and `stopLeftoverTunnel` can stop a cloudflared a dead run left behind (only when `/proc/<pid>/cmdline`, or `ps`, shows a quick tunnel of ours). A plugin reload therefore ends every live share, and the next link has a new address.

## Transport

Quick tunnels hold server-sent events back until the stream closes (Cloudflare lists SSE as unsupported there), so the page long-polls `poll?since=<rev>&client=<id>&name=<name>`. `src/feed.ts` stamps each item, the header, the guest count and the prompt list with the revision they changed at and returns only what is newer; the poll waits up to 25 s for a change. Limits, because a quick tunnel carries 200 requests for everyone:

- `src/waiters.ts` `WaitSet`: waiting polls per page 3, per address 6, per share 40 (an over-cap poll releases the oldest as "nothing new"; a full share answers a retryable 429).
- 10 pages watch a share at once, 5 per address; a share remembers 500 pages; poll rate 120 a minute per share and address; prompts 5 a minute per address and 30 per share, 20 waiting, 200 kept (`trimSettled` never drops one still waiting, since the guest was told it was sent), 4000 characters each.
- `submit` needs a `clientId` (24 hex) the share has seen poll, so a removal cannot be dodged by leaving it out.
- The page never ends on network errors or 429 (back-off up to 30 s, a "Try now" button, `nudge` on `online` and visibility); only a 404 or an `ended` field ends it.
- A first poll before the thread has been read answers `rev: 0` without fixing the guest's starting point (with history off, that point decides what they may see).
- The visitor's address is `cf-connecting-ip` (only cloudflared reaches the port). A local process that learned the port could forge it to dodge the per-address limits but would still need the token.

## Reading the thread

`readThread` in `server.ts` reads the timeline with `includeNestedRows: "true"` (the work counts need the turns' children) and `deferContent: "true"` (tool content is never read here; `change.path` and message text survive it). It is read as a delta: `src/delta.ts` holds the newest page and its `tag`, a refresh names the last tag, and `applyDelta` rebuilds the page (the same rule Pinned Turns and Minimap use; each plugin carries its own copy). A whole page is read when there is no tag, when the page is 60 s old (`FULL_EVERY_MS`), or when a delta does not fit. Measured on a long thread (72 rows, 517 nested rows): a whole read is 1.75 MB (1.38 MB with `deferContent`), a delta is 121 bytes when nothing moved and 1 to 5 KB after tool calls; 40 chained deltas on a live thread each gave exactly the transcript a full read gave (`/tmp`-style check: build `guestTranscript` from the held page and from a fresh full read and compare).

A refresh runs after each `experimental_thread.events` event (the SDK debounces it to once a second per thread) and `thread.active|idle|failed`, only while someone watches; a 30 s timer is the net under it. A thread nobody watches is not read: the feed is marked not ready and read when a guest polls. `guestTranscript` takes a `ParseMemo`, so only changed messages are masked and parsed. At most 300 items go to a guest (`MAX_ITEMS`), and a message is cut at 64,000 characters.

## What a guest may see (`src/model.ts`)

`guestTranscript`: user and assistant text; runs of tool work collapsed into counts ("Ran 3 commands, edited 2 files"); no reasoning, tool names, commands, paths, output or diffs; a message from another agent or from BB itself becomes a one-line note. `maskSecrets` (best effort) replaces PEM blocks, known token shapes, `Bearer …`, URL credentials and values beside secret-looking names with `[hidden]`; it, `parseInline` and the heading and quote rules are linear (tests give them a time budget) and quote depth is capped at 6, because a deep run once overflowed the stack and stopped every guest's feed. A small Markdown parser builds a tree that the page turns into DOM with `textContent` only, under a nonce CSP.

Guest text is plain text: `plainText` keeps printable ASCII and line breaks only (emoji, accents, other alphabets, zero-width, direction-control and "tag" characters go, because they can smuggle in instructions the owner cannot see), for prompts and names. `cleanName` also drops colons and the word "says" and refuses reserved role names (also with look-alike digits), so a guest cannot pass as Owner, System, BB or the agent in the card or in "Name says: …".

Per-link choices (all in memory, set from the card's settings): `showHistory` (when off, a guest's first poll records the item ids that exist and `hideHistory` in `src/feed.ts` filters them out, prompts included), `guestsSee` (`own`, `count` (default), `prompts`; `own` sends `setGuests(null)` so the page shows the icon with no number and keeps the shared prompt list empty, `prompts` also sends everyone's prompts as `{id, name, text}` with the text masked), `showModel` (off; the model and effort are only looked up and sent when on).

## The owner's side

The card (`src/Card.tsx`) is a composer banner (`app.composer.customize`, `chrome: "bare"`), one 36 px row in the shape of BB's git row: green pulsing `ShareIcon`, "N guests", one timer "<elapsed> of <length>" (`elapsedLabel`, `leftLabel`), a yellow pulsing "N pending", and icon buttons (copy link, settings, stop). Only the elapsed text re-renders each second (`Elapsed`, `useNow`). It opens on click (everything left of the link icon) and a new prompt only raises the pending count. Opened, it shows a collapsed History (oldest first, newest at the bottom, 200 px high, opened by hand only, Copy on each) and Prompt Approval (scrolls at `min(40vh, 320px)`, each prompt cut at four lines, Use / Copy / Dismiss in a right-hand column).

Nothing a guest writes is ever sent to the agent by the plugin (no `threads.send`). **Use** puts the bare text in the owner's composer (`useComposer().insert`) and then calls `use_prompt`; its menu (`src/SplitButton.tsx`, portalled to the body, closes on Esc, outside click, scroll, resize) offers **Use with the name**, which inserts `attributed(name, text)` (`Lydia says: <text>`, or the name on its own line above a multi-line prompt). Copy only copies. Guests are never told what the owner did: every prompt shows the same grey tick ("Sent").

The settings overlay (`src/Config.tsx`, portalled to the body): connected guests with Kick (`kick` RPC; the id is refused afterwards), the link's expiry (`configure`, restarts the timer), the history switch, the "Guests see about each other" choice, the model switch. It keeps `onClose` in a ref: the card passes a new function on every render and each owner-state push renders it, and an effect keyed on it focused the dialog again, taking focus from the field being typed in.

Push: `NoticeBatch` (`src/notify.ts`) sends the first prompt at once and a summary every 30 s, through the Push Notifications plugin (`notifications.send`) when it is there. The `share` RPC takes `via: "app"` from the menu and the card; any other caller gets a log warning and a push "A guest link was started". The SDK's RPC caller is only `plugin` or `client`, so the CLI cannot be told from the app: this is a tripwire, not a lock, and spoofable. `redactTunnelLine` cuts the token and query out of every cloudflared line before it is logged.

## The guest page (`src/page.ts`)

One HTML page with its CSS and script as strings (so the build's utility-word rule applies to them). It copies BB's own thread look: BB's colour tokens, a 728 px column, a composer whose toolbar holds the model chip (only when shown), "You are <name>" with a rename icon, the guest count and BB's return-arrow send button; Enter sends. The whole document scrolls (`document.scrollingElement`; the bar sticks to the bottom and has no background of its own, only `.gv-solid` covers the text); all sizes are 20 % above BB's 13 px base. The textarea is one line while idle (`.gv-peek` shows the draft or the hint) and at least two while focus is inside the form, growing with its text up to 40vh; `fit` measures at `auto`, puts the old height back, reads `offsetHeight` and then sets the new one so the height change animates from where it was. The "N sent" list (`renderMine`, `toggleOpen`) animates between its two measured sizes with the Web Animations API. Items are keyed by `JSON.stringify` and only changed ones are rebuilt.

The name is asked once and kept in localStorage `guest-view:name`, with the client id `guest-view:client`. A poll waits up to 25 s, so the guest can type a new name while one is waiting; the answer carries the name that poll was sent with. `apply(data, sent)` therefore adopts the server's cleaned name (`you`) only when the page still has the name it sent, otherwise the stale answer replaced what the guest had just typed. A second tab of the same browser has the same client id and stored name, so a `storage` event makes it follow a rename (otherwise the two tabs poll with different names and the owner sees them flip).

## cloudflared

Never installed unasked. When it is missing the card shows the command and, on Linux, **Install it for me**, which downloads one pinned release (`CLOUDFLARED_VERSION` in `src/install.ts`, with the SHA-256 and size of each Linux asset from Cloudflare's release notes) into `~/.local/bin` and writes nothing unless both match. Bump the version and the hashes together; the card's manual command checks the same hash. `Tunnel.stop()` sends SIGTERM and SIGKILL after 3 s; `stopServerIfUnused` awaits it. The log lines of cloudflared are at debug.

## Build gotchas

- `bb plugin build` turns any utility word standing alone anywhere in the folder (code, comments, tests, docs) into a page-wide rule. Split the word (`"vis" + "ible"`, `"re" + "size"`, `"hid" + "den"`) or reword; `[hidden]`, `aria-hidden` and `(hidden)` are fine. Check `grep -c ':where(\[data-bb-plugin=' dist/app.css` is 0 after every build. The icon's paths are baked at 24 units with no matrix attribute for the same reason.
- Thread actions take icon names only, so `app.tsx` registers `ShareIcon` as `guest-view/share`; `src/mark.ts` draws the one icon every surface uses (card, menu, guest page, `icons/guest-view.svg`).
- The page's script is checked by `src/page.test.ts` (it parses, every id it looks up exists, the boot data cannot close its tag), not run; run it in a browser after changing it.

## Tests and checking in a browser

`pnpm --filter bb-plugin-guest-view test` runs `src/*.test.ts`. `src/server.test.ts` runs the real `server.ts` and guest HTTP server with a fake `bb` and a shell script standing in for cloudflared (its fake timeline can answer tagged deltas). `src/delta.test.ts` covers the delta rebuild and the full-read fallbacks.

To look at the guest page in a headless browser, start the same pair (the real `server.ts`, a fake `bb`, a fake cloudflared) in a small script and open the printed local address; a share of a real thread over a real tunnel can only be started by the owner (the auto-mode classifier refuses an agent starting "External Ingress Tunnel", and that should not be worked around). The owner's card and settings only exist on a thread with a live share, so they need the owner to start one. `bb browser-automation` screenshots must be JPEG; the card sits in `[data-scroll-footer]` inside the timeline scroller, so hide `[data-timeline-items]`, not the scroller, to photograph it.
