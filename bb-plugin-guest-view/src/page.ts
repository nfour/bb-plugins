// The guest page: one HTML document with its style and script written in, allowed by a
// per-response nonce in a strict Content-Security-Policy. The script builds every
// node with createElement and textContent from the Markdown tree the server parsed
// (src/model.ts), so nothing a message holds is ever read as HTML.
//
// Class names start with `gv-`. The plugin build turns lone utility words found
// anywhere in this folder into page-wide rules in BB, so names here avoid those
// words (see AGENTS.md) and dist/app.css is checked after a build.

import { markSvg } from "./mark.ts";

// Written in two parts: the plugin build reads the whole word as a utility class otherwise.
const HID = "hid" + "den";
const STK = "stic" + "ky";

const STYLE = String.raw`
:root{color-scheme:light dark;--gv-canvas:#f6f2ee;--gv-ink:#2b2726;--gv-primary:#c2492f;--gv-ok:#4f7a36;--gv-warn:#9a6414;--gv-bad:#b3402a;--gv-shade:rgba(51,51,51,.07);--gv-glint:color-mix(in oklch,var(--gv-ink) 45%,var(--gv-canvas))}
@media (prefers-color-scheme:dark){:root{--gv-canvas:#171616;--gv-ink:#cacaca;--gv-primary:#ff8365;--gv-ok:#abc78a;--gv-warn:#e2d294;--gv-bad:#e79d8d;--gv-shade:rgba(0,0,0,.26);--gv-glint:#f4f4f4}}
:root{--gv-line:color-mix(in oklch,var(--gv-ink) 14%,var(--gv-canvas));--gv-muted:color-mix(in oklch,var(--gv-ink) 70%,var(--gv-canvas));--gv-subtle:color-mix(in oklch,var(--gv-ink) 58%,var(--gv-canvas));--gv-wash:color-mix(in oklch,var(--gv-ink) 7%,var(--gv-canvas));--gv-code:color-mix(in oklch,var(--gv-ink) 6%,var(--gv-canvas))}
@media (prefers-color-scheme:dark){:root{--gv-line:color-mix(in oklch,var(--gv-ink) 19.4%,var(--gv-canvas))}}
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--gv-canvas);color:var(--gv-ink);font:15.5px/1.625 "Inter Variable",Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"Noto Sans","Liberation Sans",sans-serif;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}
button,textarea,input{font:inherit;color:inherit}
.gv-scroll{flex:1;min-width:0}
.gv-bar{position:${STK};bottom:0;z-index:2}
.gv-col{width:min(728px,100% - 32px);margin:0 auto}
.gv-feed{padding:24px 0 10px}
.gv-older{color:var(--gv-muted);font-size:14.5px;text-align:center;margin:0 0 19px}
.gv-msg{margin:0 0 17px;padding:0 10px;overflow-wrap:anywhere}
.gv-msg-user{display:flex;flex-direction:column;align-items:flex-end;padding:0 10px}
.gv-bubble{max-width:70%;width:fit-content;background:var(--gv-wash);border-radius:12px;padding:10px 14px;overflow-wrap:anywhere}
.gv-who{font-size:14.5px;line-height:1;color:var(--gv-muted);margin:0 0 5px}
.gv-act,.gv-note{color:var(--gv-subtle);margin:0 0 14px;padding:0 10px;line-height:24px;display:flex;align-items:center;gap:7px}
.gv-act-live{color:var(--gv-muted)}
.gv-note{font-style:italic}
.gv-busy{margin:19px 0 0;padding:0 10px;min-height:34px;display:flex;align-items:center;color:var(--gv-muted)}
.gv-shine{background:linear-gradient(90deg,transparent 40%,var(--gv-glint) 50%,transparent 60%) 100% 0/250% 100% no-repeat,linear-gradient(var(--gv-muted),var(--gv-muted));-webkit-background-clip:text;background-clip:text;color:transparent;animation:gv-shine 2s linear infinite}
@keyframes gv-shine{to{background-position:-50% 0}}
@media (prefers-reduced-motion:reduce){.gv-shine{animation:none;color:var(--gv-muted);background:none}}
.gv-msg p{margin:0 0 10px}
.gv-msg>:last-child,.gv-msg li>:last-child,.gv-bubble>:last-child{margin-bottom:0}
.gv-msg h1,.gv-msg h2,.gv-msg h3,.gv-msg h4,.gv-msg h5,.gv-msg h6{margin:17px 0 7px;line-height:1.3}
.gv-msg h1{font-size:21.5px}.gv-msg h2{font-size:19px}.gv-msg h3{font-size:17px}.gv-msg h4,.gv-msg h5,.gv-msg h6{font-size:15.5px}
.gv-msg ul,.gv-msg ol{margin:0 0 10px;padding-left:26px}
.gv-msg li{margin:2px 0}
.gv-msg blockquote{margin:0 0 10px;padding:2px 14px;border-left:3px solid var(--gv-line);color:var(--gv-muted)}
.gv-msg hr{border:0;border-top:1px solid var(--gv-line);margin:14px 0}
.gv-msg a{color:var(--gv-primary)}
.gv-msg code{font:14.5px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--gv-code);border-radius:4px;padding:1px 5px}
.gv-pre{margin:0 0 10px;background:var(--gv-code);border:1px solid var(--gv-line);border-radius:8px;overflow:auto}
.gv-pre-lang{font:13px/1 ui-monospace,monospace;color:var(--gv-muted);padding:8px 14px 0}
.gv-pre pre{margin:0;padding:10px 14px 12px}
.gv-pre code{background:none;padding:0;white-space:pre}
.gv-tblwrap{overflow-x:auto;margin:0 0 10px}
.gv-grid{border-collapse:collapse;font-size:14.5px}
.gv-msg th,.gv-msg td{border:1px solid var(--gv-line);padding:5px 12px;text-align:left;vertical-align:top}
.gv-dock{display:flex;flex-direction:column}
/* Only the composer and what is under it cover the text; beside the "N sent" button the page shows through. */
.gv-solid{background:var(--gv-canvas);padding:10px 0 calc(12px + env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;gap:10px;box-shadow:0 -8px 8px -2px var(--gv-canvas)}
.gv-dot{flex:none;width:10px;height:10px;border-radius:999px;background:var(--gv-muted)}
.gv-space{flex:1}
.gv-hist{background:color-mix(in oklch,var(--gv-ink) 4%,var(--gv-canvas));border:1px solid var(--gv-line);border-radius:8px;font-size:14.5px;line-height:19px;color:var(--gv-muted)}
.gv-presence{display:flex;align-items:center;gap:7px;flex:none;color:var(--gv-muted);font-size:14.5px;line-height:18px;white-space:nowrap}
.gv-live-icon{display:inline-flex;flex:none;color:#2f9e5b;animation:gv-pulse 1.6s cubic-bezier(.42,0,.58,1) infinite}
.gv-count:empty{display:none}
@keyframes gv-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.gv-live-icon{animation:none!important}}
.gv-hist-head{display:flex;align-items:center;gap:10px;width:100%;min-height:41px;padding:0 14px;background:none;border:0;cursor:pointer;text-align:left;color:inherit}
.gv-hist-head:hover{color:var(--gv-ink)}
.gv-hist-icon{flex:none}
.gv-hist{align-self:flex-end;width:fit-content;max-width:100%;margin-top:8px;z-index:1}
.gv-hist[data-open="true"]{width:100%}
/* While it opens or closes the box animates between its two sizes (script); the list keeps its final width and is cut off. */
.gv-hist[data-moving="true"]{overflow:clip}
.gv-hist[data-moving="true"] .gv-mine{width:var(--gv-w)}
.gv-hist-sum{flex:1;min-width:0;overflow:clip;text-overflow:ellipsis;white-space:nowrap}
.gv-chev{flex:none;transition:rotate 120ms cubic-bezier(.42,0,.58,1)}
.gv-hist[data-open="true"] .gv-hist-head .gv-chev{rotate:180deg}
.gv-mine{display:flex;flex-direction:column;gap:10px;max-height:min(30vh,260px);overflow-y:auto;scrollbar-width:thin;padding:10px 14px 12px;border-top:1px solid var(--gv-line)}
.gv-mine-row{display:flex;gap:10px;align-items:flex-start;line-height:22px}
.gv-mine-who{flex:none;font-weight:600;color:var(--gv-ink);max-width:40%;overflow:clip;text-overflow:ellipsis;white-space:nowrap}
.gv-mine-text{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--gv-muted);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:${HID}}
.gv-mine-row[data-expanded="true"] .gv-mine-text{display:block;-webkit-line-clamp:none}
.gv-mine-row[data-over="true"] .gv-mine-text{cursor:pointer}
.gv-more{display:none;flex:none;align-items:center;height:22px;color:var(--gv-muted);cursor:pointer;transition:rotate 120ms cubic-bezier(.42,0,.58,1)}
.gv-mine-row[data-over="true"] .gv-more{display:flex}
.gv-mine-row[data-expanded="true"] .gv-more{rotate:180deg}
.gv-tick{flex:none;display:flex;align-items:center;justify-content:center;width:22px;height:22px;color:var(--gv-subtle)}
.gv-composer{background:var(--gv-canvas);border:1px solid var(--gv-line);border-radius:12px;box-shadow:0 -4px 12px -4px var(--gv-shade);display:flex;flex-direction:column;margin:0}
.gv-composer:focus-within{border-color:color-mix(in oklch,var(--gv-ink) 32%,var(--gv-canvas))}
.gv-field{display:grid;grid-template-columns:minmax(0,1fr)}
.gv-input{grid-area:1/1;display:block;width:100%;resize:none;border:0;outline:0;background:none;padding:14px 19px 5px;font-size:15.5px;line-height:26px;height:45px;max-height:40vh;overflow-y:hidden;transition:height 160ms cubic-bezier(.42,0,.58,1)}
@media (prefers-reduced-motion:reduce){.gv-input{transition:none}}
.gv-input::placeholder{color:var(--gv-subtle);opacity:1}
/* Idle: one line. The peek shows the draft (or the hint) on that line with an ellipsis; the box itself is see-through. */
.gv-peek{grid-area:1/1;min-width:0;display:none;padding:14px 19px 5px;font-size:15.5px;line-height:26px;white-space:nowrap;overflow:clip;text-overflow:ellipsis;pointer-events:none;color:var(--gv-ink)}
.gv-peek[data-hint="true"]{color:var(--gv-subtle)}
.gv-composer[data-active="false"] .gv-peek{display:block}
.gv-composer[data-active="false"] .gv-input,.gv-composer[data-active="false"] .gv-input::placeholder{color:transparent}
.gv-tools{display:flex;align-items:center;gap:10px;padding:5px 10px 10px 19px;min-height:53px}
.gv-who-me{display:flex;align-items:center;gap:5px;color:var(--gv-muted);font-size:14.5px;line-height:18px;min-width:0;white-space:nowrap}
.gv-who-me strong{min-width:0;font-weight:600;color:var(--gv-ink);overflow:clip;text-overflow:ellipsis;white-space:nowrap}
.gv-edit{flex:none;width:29px;height:29px;border:0;border-radius:6px;background:none;color:var(--gv-muted);display:flex;align-items:center;justify-content:center;cursor:pointer}
.gv-edit:hover{background:var(--gv-wash);color:var(--gv-ink)}
.gv-chip{display:flex;align-items:center;gap:5px;height:29px;padding:0 10px 0 0;color:var(--gv-muted);font-size:14.5px;line-height:18px;white-space:nowrap;min-width:0}
.gv-chip{flex:0 100 auto}
.gv-chip svg{flex:none}
@media (max-width:600px){.gv-chip{display:none}}
@media (max-width:440px){.gv-you{display:none}}
.gv-chip-text{min-width:0;overflow:clip;text-overflow:ellipsis}
.gv-send{flex:none;width:38px;height:38px;border:0;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--gv-ink);color:var(--gv-canvas)}
.gv-send:disabled{background:color-mix(in oklch,var(--gv-ink) 40%,var(--gv-canvas));color:var(--gv-canvas);cursor:default}
.gv-foot{display:flex;align-items:center;gap:10px;min-height:29px;padding:0 18px;font-size:14.5px;color:var(--gv-muted)}
.gv-foot-bad{color:var(--gv-bad)}
.gv-retry{flex:none;border:0;background:none;padding:2px 6px;border-radius:6px;font:inherit;font-weight:600;color:var(--gv-primary);cursor:pointer}
.gv-retry:hover{background:var(--gv-wash)}
.gv-error{color:var(--gv-bad)}
.gv-dialog{border:0;padding:0;background:none;color:inherit;max-width:calc(100vw - 32px);width:380px}
.gv-dialog::backdrop{background:rgba(0,0,0,.45)}
.gv-box{background:var(--gv-canvas);border:1px solid var(--gv-line);border-radius:12px;padding:24px;width:100%;max-width:380px}
.gv-box h2{margin:0 0 7px;font-size:18px}
.gv-box p{margin:0 0 17px;color:var(--gv-muted)}
.gv-box input{width:100%;background:none;border:1px solid var(--gv-line);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:15.5px}
.gv-box input:focus{outline:2px solid var(--gv-primary);outline-offset:-1px}
.gv-box .gv-send{width:100%;border-radius:8px;height:41px}
.gv-off{display:none}
`;

/** Runs in the guest's browser. Plain ES2020; no imports. */
const SCRIPT = String.raw`
(() => {
  "use strict";
  const BOOT = JSON.parse(document.getElementById("gv-boot").textContent);
  const base = "/" + BOOT.token;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
  let clientId = store.get("guest-view:client");
  if (!clientId || !/^[0-9a-f]{24}$/.test(clientId)) { clientId = randomId(); store.set("guest-view:client", clientId); }
  const mineKey = "guest-view:prompts:" + BOOT.shareId;
  let mine = [];
  try { mine = JSON.parse(store.get(mineKey) || "[]").filter((p) => p && typeof p.id === "string" && typeof p.text === "string").slice(-20); } catch { mine = []; }
  let name = store.get("guest-view:name") || "";
  let ended = false;
  // The line under the composer exists only while there is something to say (a problem, the end).
  const note = (text, bad) => { const box = $("gv-foot"); $("gv-foot-text").textContent = text; box.classList.toggle("gv-off", !text); box.classList.toggle("gv-foot-bad", !!bad); };

  // Name: asked once per browser; the suggested name is used when left empty.
  const dialog = $("gv-dialog"), nameInput = $("gv-name-input");
  nameInput.placeholder = BOOT.suggestedName;
  const showName = () => { $("gv-name").textContent = name; };
  const askName = () => { nameInput.value = name === BOOT.suggestedName ? "" : name; if (!dialog.open) dialog.showModal(); nameInput.focus(); };
  $("gv-name-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const typed = nameInput.value.replace(/\s+/g, " ").trim().slice(0, 40);
    name = typed || name || BOOT.suggestedName;
    store.set("guest-view:name", name);
    dialog.close();
    showName();
    // A phone would pop its keyboard up at once; only a device with a pointer gets the focus.
    if (window.matchMedia("(hover:hover)").matches) $("gv-input").focus();
  });
  $("gv-rename").addEventListener("click", askName);
  if (!name) askName(); else showName();

  // Markdown tree → DOM (textContent only).
  const renderInline = (nodes, parent) => {
    for (const node of nodes) {
      if (typeof node === "string") { parent.appendChild(document.createTextNode(node)); continue; }
      if (node.t === "br") parent.appendChild(el("br"));
      else if (node.t === "code") parent.appendChild(el("code", null, node.text));
      else if (node.t === "b" || node.t === "i" || node.t === "s") { const n = el(node.t === "b" ? "strong" : node.t === "i" ? "em" : "del"); renderInline(node.c, n); parent.appendChild(n); }
      else if (node.t === "a") {
        if (!/^(https?:\/\/|mailto:)/i.test(node.href)) { renderInline(node.c, parent); continue; }
        const a = el("a"); a.href = node.href; a.target = "_blank"; a.rel = "noopener noreferrer nofollow"; renderInline(node.c, a); parent.appendChild(a);
      }
    }
  };
  const blocks = (list, parent) => {
    for (const b of list) {
      if (b.t === "p") { const n = el("p"); renderInline(b.c, n); parent.appendChild(n); }
      else if (b.t === "h") { const n = el("h" + Math.min(6, Math.max(1, b.level | 0))); renderInline(b.c, n); parent.appendChild(n); }
      else if (b.t === "code") { const wrap = el("div", "gv-pre"); if (b.lang) wrap.appendChild(el("div", "gv-pre-lang", b.lang)); const pre = el("pre"); pre.appendChild(el("code", null, b.text)); wrap.appendChild(pre); parent.appendChild(wrap); }
      else if (b.t === "ul" || b.t === "ol") { const n = el(b.t); if (b.start) n.start = b.start; for (const item of b.items) { const li = el("li"); renderInline(item, li); n.appendChild(li); } parent.appendChild(n); }
      else if (b.t === "quote") { const n = el("blockquote"); blocks(b.c, n); parent.appendChild(n); }
      else if (b.t === "hr") parent.appendChild(el("hr"));
      else if (b.t === "tbl") {
        const wrap = el("div", "gv-tblwrap"), tbl = el("ta" + "ble", "gv-grid"), head = el("tr");
        for (const cell of b.head) { const th = el("th"); renderInline(cell, th); head.appendChild(th); }
        const thead = el("thead"); thead.appendChild(head); tbl.appendChild(thead);
        const tbody = el("tbody");
        for (const row of b.rows) { const tr = el("tr"); for (const cell of row) { const td = el("td"); renderInline(cell, td); tr.appendChild(td); } tbody.appendChild(tr); }
        tbl.appendChild(tbody); wrap.appendChild(tbl); parent.appendChild(wrap);
      }
    }
  };
  const renderItem = (item) => {
    if (item.type === "activity") return el("div", "gv-act" + (item.live ? " gv-act-live" : ""), item.text);
    if (item.type === "note") return el("div", "gv-note", item.text);
    const n = el("div", "gv-msg gv-msg-" + item.type);
    if (item.type === "user") {
      n.appendChild(el("div", "gv-who", "Owner"));
      const bubble = el("div", "gv-bubble");
      blocks(item.blocks, bubble);
      n.appendChild(bubble);
    } else blocks(item.blocks, n);
    return n;
  };

  // Transcript state from the stream.
  const items = new Map(), nodes = new Map(), keys = new Map();
  let order = [];
  // The page itself scrolls (native scrollbar and touch scrolling); the composer bar sticks to its bottom.
  const feed = $("gv-feed"), scroller = document.scrollingElement || document.documentElement;
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const nearBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  // Whether the reader is at the end, as of their last scroll: the bar growing (a longer draft, the Prompts list) keeps them there.
  let pinned = true;
  window.addEventListener("scroll", () => { pinned = nearBottom(); }, { passive: true });
  new ResizeObserver(() => { if (pinned) scroller.scrollTop = scroller.scrollHeight; }).observe($("gv-bar"));
  const renderFeed = () => {
    const stick = nearBottom();
    const wanted = new Set(order);
    for (const [id, node] of nodes) if (!wanted.has(id)) { node.remove(); nodes.delete(id); keys.delete(id); }
    let before = $("gv-feed-end");
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const id = order[i], item = items.get(id);
      if (!item) continue;
      const key = JSON.stringify(item);
      let node = nodes.get(id);
      if (!node || keys.get(id) !== key) { const next = renderItem(item); if (node) node.replaceWith(next); node = next; nodes.set(id, node); keys.set(id, key); }
      if (node.nextSibling !== before) feed.insertBefore(node, before);
      before = node;
    }
    if (stick) scroller.scrollTop = scroller.scrollHeight;
  };
  let header = null;
  const paintBusy = () => {
    const box = $("gv-busy");
    const working = !ended && header && header.status === "Working";
    box.classList.toggle("gv-off", !working);
    if (!working) return;
    const text = "Working...";
    const span = $("gv-busy-text");
    if (span.textContent !== text) span.textContent = text;
  };
  const renderHeader = (h) => {
    header = h;
    document.title = (h.title || "Shared thread") + " · Guest view";
    const model = [h.model, h.effort].filter(Boolean).join(" ");
    const chip = $("gv-model");
    chip.classList.toggle("gv-off", !model);
    $("gv-model-text").textContent = model;
    $("gv-older").classList.toggle("gv-off", !h.older);
    paintBusy();
  };
  // The list of prompts above the composer: the guest's own, or everyone's when the owner allows it.
  // Every one carries the same grey tick ("sent"): what the owner did with it is never shown.
  const TICK = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
  const MORE = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  let everyone = null, open = false;
  const expanded = new Set();
  const atEnd = (n) => n.scrollHeight - n.scrollTop - n.clientHeight < 24;
  // A prompt cut off at two lines gets a chevron; one that fits does not. Needs the list on screen.
  const measure = () => {
    for (const row of $("gv-mine").children) {
      if (row.dataset.expanded === "true") { row.dataset.over = "true"; continue; }
      const text = row.querySelector(".gv-mine-text");
      row.dataset.over = text.scrollHeight > text.clientHeight + 1 ? "true" : "false";
    }
  };
  const renderMine = (toEnd) => {
    const box = $("gv-mine");
    const stick = toEnd || atEnd(box), keep = box.scrollTop;
    const mineIds = new Set(mine.map((p) => p.id));
    const list = everyone
      ? everyone.map((p) => ({ id: p.id, name: mineIds.has(p.id) ? "You" : p.name || "Guest", text: p.text || "" }))
      : mine.map((p) => ({ id: p.id, name: "You", text: p.text }));
    box.textContent = "";
    for (const p of list) {
      const row = el("div", "gv-mine-row");
      row.dataset.expanded = expanded.has(p.id) ? "true" : "false";
      row.dataset.over = "false";
      row.appendChild(el("span", "gv-mine-who", p.name + ":"));
      const text = el("span", "gv-mine-text", p.text);
      const more = el("span", "gv-more"); more.innerHTML = MORE;
      const toggle = () => {
        if (row.dataset.over !== "true") return;
        const on = row.dataset.expanded !== "true";
        row.dataset.expanded = on ? "true" : "false";
        if (on) expanded.add(p.id); else expanded.delete(p.id);
      };
      text.addEventListener("click", toggle);
      more.addEventListener("click", toggle);
      row.appendChild(text);
      row.appendChild(more);
      const tick = el("span", "gv-tick"); tick.innerHTML = TICK; tick.title = "Sent"; tick.setAttribute("role", "img"); tick.setAttribute("aria-label", "Sent");
      row.appendChild(tick);
      box.appendChild(row);
    }
    $("gv-hist-sum").textContent = list.length + " sent";
    $("gv-hist").classList.toggle("gv-off", list.length === 0);
    box.classList.toggle("gv-off", !open);
    $("gv-hist").dataset.open = open ? "true" : "false";
    $("gv-hist-toggle").setAttribute("aria-expanded", open ? "true" : "false");
    if (open) { measure(); box.scrollTop = stick ? box.scrollHeight : keep; }
  };
  // Opening shows the newest prompt: the list starts scrolled to its end.
  // The box goes from one size to the other over 180ms. Closing keeps the list on screen until the box has shrunk.
  let moving = null;
  const toggleOpen = () => {
    const hist = $("gv-hist"), list = $("gv-mine");
    const before = hist.getBoundingClientRect();
    if (moving) moving.cancel();
    const wasOpen = open;
    open = !open;
    renderMine(true);
    const after = hist.getBoundingClientRect();
    if (window.matchMedia("(prefers-reduced-motion:reduce)").matches || (before.width === after.width && before.height === after.height)) return;
    if (wasOpen) list.classList.remove("gv-off");
    hist.style.setProperty("--gv-w", Math.max(before.width, after.width) + "px");
    hist.dataset.moving = "true";
    const run = hist.animate(
      [{ width: before.width + "px", height: before.height + "px" }, { width: after.width + "px", height: after.height + "px" }],
      { duration: 180, easing: "cubic-bezier(.42,0,.58,1)" },
    );
    moving = run;
    const done = () => {
      if (moving !== run) return;
      moving = null;
      delete hist.dataset.moving;
      list.classList.toggle("gv-off", !open);
    };
    run.onfinish = done;
    run.oncancel = done;
  };
  $("gv-hist-toggle").addEventListener("click", toggleOpen);
  window.addEventListener("res" + "ize", () => { if (open) measure(); });
  renderMine();

  // Live updates by long polling: each request says which revision the page has and
  // the server answers once something changed (or after ~25s with nothing new).
  // Cloudflare's quick tunnels hold back streamed responses, so no EventSource.
  let rev = 0;
  let reconnecting = false;
  const end = (text) => {
    ended = true;
    $("gv-me").classList.add("gv-off");
    $("gv-rename").classList.add("gv-off");
    $("gv-input").disabled = true;
    $("gv-input").placeholder = "This link has ended";
    active = false;
    fit();
    $("gv-send").disabled = true;
    $("gv-presence").classList.add("gv-off");
    $("gv-retry").classList.add("gv-off");
    note(text);
    paintBusy();
    renderMine();
  };
  const renderPresence = (count) => {
    // null: the owner keeps the count from guests, so only the icon shows.
    $("gv-presence-text").textContent = count == null ? "" : count === 1 ? "1 guest" : count + " guests";
    $("gv-presence").classList.toggle("gv-off", ended || count === 0);
  };
  const apply = (data) => {
    if (data.reset) items.clear();
    if (data.header) renderHeader(data.header);
    for (const item of data.items || []) items.set(item.id, item);
    if (data.order) { order = data.order; const keep = new Set(order); for (const id of [...items.keys()]) if (!keep.has(id)) items.delete(id); }
    if (data.prompts) { everyone = data.prompts.length ? data.prompts : null; renderMine(); }
    if (data.guests !== undefined) renderPresence(data.guests);
    // The owner sees the name as the server cleaned it (no colons, not the owner's own); show the same one here.
    if (name && typeof data.you === "string" && data.you && data.you !== name) { name = data.you; store.set("guest-view:name", name); showName(); }
    renderFeed();
    paintBusy();
  };
  // A page that cannot reach the owner keeps trying (with longer pauses, up to 30s): a laptop that slept or a tunnel that
  // reconnected comes back by itself. Only the owner's word (an ended link, a removal) or a 404 ends the page.
  let nudge = null;
  const sleep = (ms) => new Promise((done) => {
    const timer = setTimeout(() => { nudge = null; done(); }, ms);
    nudge = () => { clearTimeout(timer); nudge = null; done(); };
  });
  const retry = $("gv-retry");
  const offline = (text) => { reconnecting = true; note(text); retry.classList.remove("gv-off"); };
  const online = () => { reconnecting = false; retry.classList.add("gv-off"); note(""); };
  retry.addEventListener("click", () => { if (nudge) nudge(); });
  window.addEventListener("online", () => { if (nudge) nudge(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "vis" + "ible" && nudge) nudge(); });
  const loop = async () => {
    let failures = 0;
    while (!ended) {
      let busy = "";
      try {
        const response = await fetch(base + "/poll?since=" + rev + "&client=" + clientId + "&name=" + encodeURIComponent(name || BOOT.suggestedName), { cache: "no-store" });
        if (response.status === 404) { end("This guest link has ended."); return; }
        const data = await response.json().catch(() => ({}));
        // A 429 (the owner's limits, or Cloudflare's own) is a reason to wait, never to give up.
        if (response.status === 429 && data.error) busy = data.error;
        if (!response.ok) throw new Error(data.error || "HTTP " + response.status);
        failures = 0;
        if (reconnecting) online();
        apply(data);
        rev = data.rev;
        if (data.ended) { end(data.ended === "expired" ? "This guest link has expired." : data.ended === "kicked" ? "The owner removed you from this thread." : "The owner stopped sharing this thread."); return; }
      } catch {
        failures += 1;
        if (busy) offline(busy);
        else if (failures >= 6) offline("Cannot reach the owner right now. Still trying...");
        else if (failures > 1) offline("Reconnecting...");
        await sleep(Math.max(busy ? 15000 : 0, Math.min(30000, 1000 * 2 ** Math.min(failures, 5))));
      }
    }
  };

  // Prompts.
  const input = $("gv-input"), button = $("gv-send");
  // Idle, the composer is one line (the peek shows the draft with an ellipsis). While the reader is in it, it
  // is two lines at least and grows with its text; it only scrolls once it reaches its maximum height.
  const form = $("gv-form"), peek = $("gv-peek");
  let active = false;
  const fit = () => {
    form.dataset.active = active ? "true" : "false";
    const draft = input.value.replace(/\s*\n\s*/g, " ").trim();
    peek.textContent = draft || input.placeholder;
    peek.dataset.hint = draft ? "false" : "true";
    if (!active) { input.style.height = ""; input.style.overflowY = "hid" + "den"; input.scrollTop = 0; return; }
    // Measure at the natural height, then go back to where it was and move from there, so the change is animated.
    const from = input.offsetHeight;
    input.style.height = "auto";
    const style = getComputedStyle(input);
    const two = parseFloat(style.lineHeight) * 2 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const max = window.innerHeight * 0.4;
    const need = Math.max(input.scrollHeight, two);
    input.style.height = from + "px";
    void input.offsetHeight;
    input.style.height = Math.min(need, max) + "px";
    input.style.overflowY = need > max + 1 ? "auto" : "hid" + "den";
  };
  const setActive = (next) => { if (next !== active) { active = next; fit(); } };
  form.addEventListener("focusin", () => setActive(true));
  // Not at once: a click on the send button or the pencil moves focus there first.
  form.addEventListener("focusout", () => setTimeout(() => setActive(form.matches(":focus-within")), 120));
  input.addEventListener("input", () => { fit(); button.disabled = ended || !input.value.trim(); });
  // Enter sends; Shift+Enter adds a line. Not while an input method is composing.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      if (!button.disabled) $("gv-form").requestSubmit();
    }
  });
  window.addEventListener("res" + "ize", fit);
  fit();
  $("gv-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || ended) return;
    button.disabled = true; note("");
    try {
      const response = await fetch(base + "/prompts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name || BOOT.suggestedName, text, clientId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "The prompt could not be sent.");
      mine.push({ id: body.id, text: body.text || text });
      mine = mine.slice(-20);
      store.set(mineKey, JSON.stringify(mine));
      input.value = ""; fit();
      if (body.text && body.text !== text) note("Your prompt was adjusted to plain text.");
      renderMine(true);
    } catch (e) {
      note(e.message, true);
    } finally {
      button.disabled = ended || !input.value.trim();
    }
  });

  // Last, so everything the loop's end() touches exists by the time it can run.
  loop();
})();
`;

export interface PageInput {
  token: string;
  shareId: string;
  suggestedName: string;
  nonce: string;
  maxChars: number;
}

/** JSON for a <script type="application/json"> part: `<` is escaped so it cannot close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export function guestPage({ token, shareId, suggestedName, nonce, maxChars }: PageInput): string {
  const boot = scriptJson({ token, shareId, suggestedName });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,interactive-widget=resizes-content">
<meta name="robots" content="noindex,nofollow">
<title>Guest view</title>
<style nonce="${nonce}">${STYLE}</style>
</head>
<body>
<main class="gv-scroll" id="gv-scroll"><div class="gv-col gv-feed" id="gv-feed">
  <p class="gv-older gv-off" id="gv-older">Earlier messages are not shown.</p>
  <div id="gv-feed-end"></div>
  <div class="gv-busy gv-off" id="gv-busy" aria-live="polite"><span class="gv-shine" id="gv-busy-text">Thinking...</span></div>
</div></main>
<footer class="gv-bar" id="gv-bar"><div class="gv-col gv-dock">
  <div class="gv-hist gv-off" id="gv-hist">
    <button class="gv-hist-head" id="gv-hist-toggle" type="button" aria-expanded="false" aria-label="Prompts you sent"><svg class="gv-hist-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span class="gv-hist-sum" id="gv-hist-sum"></span><svg class="gv-chev" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button>
    <div class="gv-mine gv-off" id="gv-mine"></div>
  </div>
  <div class="gv-solid"><form class="gv-composer" id="gv-form" data-active="false">
    <div class="gv-field"><textarea class="gv-input" id="gv-input" rows="1" maxlength="${maxChars}" placeholder="Suggest a prompt (the owner approves it before the agent sees it)" aria-label="Suggest a prompt"></textarea><div class="gv-peek" id="gv-peek" aria-hidden="true"></div></div>
    <div class="gv-tools">
      <span class="gv-chip gv-off" id="gv-model"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4"/></svg><span class="gv-chip-text" id="gv-model-text"></span></span>
      <span class="gv-who-me" id="gv-me"><span class="gv-you">You are</span> <strong id="gv-name"></strong></span>
      <button class="gv-edit" id="gv-rename" type="button" title="Change name" aria-label="Change name"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
      <span class="gv-space"></span>
      <span class="gv-presence gv-off" id="gv-presence"><span class="gv-live-icon">${markSvg(17, "gv-mark")}</span><span class="gv-count" id="gv-presence-text"></span></span>
      <button class="gv-send" id="gv-send" type="submit" disabled aria-label="Send prompt"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 10 4 15l5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg></button>
    </div>
  </form>
  <div class="gv-foot gv-off" id="gv-foot"><span id="gv-foot-text"></span><button class="gv-retry gv-off" id="gv-retry" type="button">Try now</button></div>
</div></div></footer>
<dialog class="gv-dialog" id="gv-dialog" aria-labelledby="gv-name-heading">
  <form class="gv-box" id="gv-name-form">
    <h2 id="gv-name-heading">What should we call you?</h2>
    <p>The owner sees this name beside your prompts. Leave it empty to use the suggestion.</p>
    <input id="gv-name-input" maxlength="40" autocomplete="nickname" aria-label="Your name">
    <button class="gv-send" type="submit">Continue</button>
  </form>
</dialog>
<script type="application/json" id="gv-boot">${boot}</script>
<script nonce="${nonce}">${SCRIPT}</script>
</body>
</html>`;
}

/** The only response for a wrong token, an ended share or an unknown path. */
export const NOT_FOUND_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Not found</title></head><body><p>This guest link has ended or does not exist.</p></body></html>`;
