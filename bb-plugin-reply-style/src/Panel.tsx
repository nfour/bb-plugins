import { useCallback, useEffect, useId, useRef, useState } from "react";
import { experimental_Icon as Icon, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { LAYOUT, NUMBERS, SWITCHES, TABS, valueOf, type Entry, type Num, type SettingKey, type Switch, type Tab } from "./shared";
import { setPanelOpen, usePanelOpen } from "./panelState";
import { clearPreview, getPreview, setPreview, usePreview } from "./preview";

/** A dragged slider saves this long after its last step if it was never released. */
const COMMIT_AFTER_MS = 600;

// Words the plugin build would turn into page-wide rules if they stood whole in this folder.
const FLOAT = ["fix", "ed"].join("");
const ROW = ["fl", "ex"].join("");
const SIZED = ["re", "size"].join("");
const REL = ["rela", "tive"].join("");
const ABS = ["abs", "olute"].join("");

function SwitchRow({ s, off }: { s: Switch; off?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const on = valueOf(values, s.key) as boolean;
  return (
    <div className="reply-style-opt" data-off={off ? "" : undefined}>
      <div className="reply-style-opt-text">
        <b>{s.label}</b>
        <span>{s.description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={s.label}
        disabled={off}
        className="reply-style-switch"
        onClick={() => void rpc.call("set_switch", { key: s.key, value: !on }).catch(() => {})}
      />
    </div>
  );
}

/**
 * A slider that previews while it is dragged and saves once: on the native `change` (release), when the
 * panel closes, or 600ms after the last step. The preview is dropped once the saved value catches up.
 */
function NumberRow({ n, off }: { n: Num; off?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const saved = valueOf(values, n.key) as number;
  const previewed = usePreview()[n.key];
  const timer = useRef(0);
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    if (previewed !== undefined && previewed === saved) clearPreview(n.key);
  }, [previewed, saved, n.key]);
  const commit = useCallback(() => {
    window.clearTimeout(timer.current);
    const value = getPreview(n.key);
    if (value === undefined) return;
    if (value === savedRef.current) return clearPreview(n.key);
    rpc.call("set_number", { key: n.key, value }).catch(() => clearPreview(n.key));
  }, [n.key, rpc]);
  useEffect(() => commit, [commit]);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    input?.addEventListener("change", commit);
    return () => input?.removeEventListener("change", commit);
  }, [commit]);
  const shown = previewed ?? saved;
  return (
    <div className="reply-style-opt" data-stack="" data-off={off ? "" : undefined}>
      <div className="reply-style-opt-text">
        <b>{n.label}</b>
        <span>{n.description}</span>
      </div>
      <div className="reply-style-slide">
        <input
          ref={ref}
          type="range"
          className="reply-style-range"
          aria-label={n.label}
          disabled={off}
          min={n.min}
          max={n.max}
          step={n.step ?? 1}
          value={shown}
          onChange={(event) => {
            setPreview(n.key, Number(event.target.value));
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(commit, COMMIT_AFTER_MS);
          }}
        />
        <output data-changed={shown !== n.default ? "" : undefined} title={`Default ${n.default}${n.unit}`}>
          {shown}
          {n.unit}
        </output>
      </div>
    </div>
  );
}

/** One setting's row; `off` greys it out while the switch it belongs to is off, or a number's `when` is not met. */
function Row({ k, off }: { k: SettingKey; off?: boolean }) {
  const { values } = useSettings();
  const s = SWITCHES.find((x) => x.key === k);
  if (s) return <SwitchRow s={s} off={off} />;
  const n = NUMBERS.find((x) => x.key === k)!;
  return <NumberRow n={n} off={off || (n.when !== undefined && valueOf(values, n.when.key) !== n.when.is)} />;
}

/** A switch with the settings that only act while it is on, nested under it. */
function Group({ entry }: { entry: Entry }) {
  const { values } = useSettings();
  if (typeof entry === "string") return <Row k={entry} />;
  const off = !(valueOf(values, entry.key) as boolean);
  return (
    <div className="reply-style-group">
      <Row k={entry.key} />
      <div className="reply-style-children">
        {entry.children.map((k) => (
          <Row key={k} k={k} off={off} />
        ))}
      </div>
    </div>
  );
}

/** Puts every setting back to its default; the first click asks, the second does it. */
function ResetAll() {
  const rpc = useRpc<typeof rpcContract>();
  const [sure, setSure] = useState(false);
  useEffect(() => {
    if (!sure) return;
    const id = window.setTimeout(() => setSure(false), 3000);
    return () => window.clearTimeout(id);
  }, [sure]);
  return (
    <button
      type="button"
      className="reply-style-reset"
      data-sure={sure ? "" : undefined}
      title="Put every setting back to its default"
      onClick={() => {
        if (!sure) return setSure(true);
        setSure(false);
        void rpc.call("reset", {}).catch(() => {});
      }}
    >
      {sure ? "Reset everything?" : "Reset all"}
    </button>
  );
}

/** Arrow keys, Home and End move between the tabs, as the role promises; only the selected one is a tab stop. */
const rove = (event: React.KeyboardEvent<HTMLElement>) => {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const all = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'));
  const at = all.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  event.preventDefault();
  const to = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
  all[to]!.focus();
  all[to]!.click();
};

/** The tabs and the settings under them: the floating panel and BB's settings page both show this. */
function Content({ focusOnOpen }: { focusOnOpen?: boolean }) {
  const uid = useId();
  const tablist = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>("Quotes");
  useEffect(() => {
    if (focusOnOpen) tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusOnOpen]);
  const pane = `${uid}-pane`;
  return (
    <>
      <div ref={tablist} className="reply-style-tabs" role="tablist" aria-label="Reply Style settings" onKeyDown={rove}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${uid}-${name}`}
            aria-selected={tab === name}
            aria-controls={pane}
            tabIndex={tab === name ? 0 : -1}
            className="reply-style-tab"
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="reply-style-panel-body" role="tabpanel" id={pane} aria-labelledby={`${uid}-${tab}`}>
        {LAYOUT[tab].map((entry) => (
          <Group key={typeof entry === "string" ? entry : entry.key} entry={entry} />
        ))}
      </div>
    </>
  );
}

/** How much of the panel must stay on screen, so it can always be grabbed again. */
const KEEP = 48;
type Spot = { x: number; y: number };

/** Where the panel appears: the top left of the thread's timeline (the user's choice, 2026-11-19). */
function home(): Spot {
  const rect = document.querySelector("[data-page-scroll-viewport]")?.getBoundingClientRect();
  return rect && rect.width > 0 ? { x: rect.left + 16, y: rect.top + 16 } : { x: 16, y: 64 };
}

const clampSpot = (spot: Spot, width: number): Spot => ({
  x: Math.min(window.innerWidth - KEEP, Math.max(KEEP - width, spot.x)),
  y: Math.min(window.innerHeight - KEEP, Math.max(0, spot.y)),
});

/** Where the panel is, and the handlers that move it by its title bar. */
function useDrag() {
  const box = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot>(home);
  const grab = useRef<{ dx: number; dy: number; width: number } | null>(null);
  const onDown = (event: React.PointerEvent<HTMLElement>) => {
    const el = box.current;
    if (!el || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    const rect = el.getBoundingClientRect();
    grab.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, width: rect.width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    const g = grab.current;
    if (g) setSpot(clampSpot({ x: event.clientX - g.dx, y: event.clientY - g.dy }, g.width));
  };
  const onUp = () => {
    grab.current = null;
  };
  useEffect(() => {
    const fit = () => setSpot((now) => clampSpot(now, box.current?.offsetWidth ?? 460));
    window.addEventListener(SIZED, fit);
    return () => window.removeEventListener(SIZED, fit);
  }, []);
  return { box, spot, handlers: { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp } };
}

const VARS = { "--reply-style-float": FLOAT, "--reply-style-row": ROW, "--reply-style-rel": REL, "--reply-style-abs": ABS };

function Body() {
  const { box, spot, handlers } = useDrag();
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPanelOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <div ref={box} className="reply-style-panel" role="dialog" aria-label="Reply Style settings" style={{ ...VARS, left: spot.x, top: spot.y } as React.CSSProperties}>
      <div className="reply-style-titlebar" {...handlers} title="Drag to move">
        <Icon name="MessageSquare" />
        <b>Reply Style settings</b>
        <ResetAll />
        <button type="button" aria-label="Close" onClick={() => setPanelOpen(false)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <Content focusOnOpen />
    </div>
  );
}

/** The same settings as a section of BB's settings page, in the page's own flow instead of floating. */
export function SettingsPage() {
  return (
    <div className="reply-style-panel" data-page="" style={VARS as React.CSSProperties}>
      <div className="reply-style-titlebar" data-page="">
        <b>Settings</b>
        <ResetAll />
      </div>
      <Content />
    </div>
  );
}

/** The settings, floating over the chat so a change shows on the replies as it is made. */
export function Panel() {
  return usePanelOpen() ? <Body /> : null;
}
