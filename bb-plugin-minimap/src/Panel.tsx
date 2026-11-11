import { useCallback, useEffect, useId, useRef, useState } from "react";
import { experimental_Icon as Icon, useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import type { SettingKey, rpcContract } from "../server";
import { BLOCKS, NUMBER_RANGES, type ColorKey, type NumberKey } from "./shared";
import type { Kind } from "./model.ts";
import { BLOCK_KEYS, useOptions } from "./options";
import { setPanelOpen, usePanelOpen } from "./panelState";
import { clearPreview, getPreview, setPreview } from "./preview";
import { usePreview } from "./usePreview";

/** A dragged control saves this long after its last step if it was never released. */
const COMMIT_AFTER_MS = 600;

// Words the plugin build would turn into page-wide rules if they stood whole in this folder.
const FLOAT = ["fix", "ed"].join("");
const ROW = ["fl", "ex"].join("");
const SIZED = ["re", "size"].join("");
const ABS = ["abs", "olute"].join("");
const REL = ["rela", "tive"].join("");

interface Setting {
  key: SettingKey;
  label: string;
  text: string;
}

const TABS = ["Behaviour", "Strip", "Scrolling", "Blocks", "Slider", "Note"] as const;

/** Tabs that hold groups of their own, shown as a second row of tabs inside the page. */
const GROUPS: Partial<Record<(typeof TABS)[number], readonly string[]>> = {
  Strip: ["Size", "Fade", "Scrollbar", "Shade"],
  Note: ["Preview", "Glide"],
};

const SCROLLBAR: Setting[] = [
  {
    key: "hideScrollbar",
    label: "Replace the scrollbar",
    text: "Hides the timeline scrollbar; off keeps both, lined up",
  },
  {
    key: "keepScrollbar",
    label: "Always show the scrollbar",
    text: "With the scrollbar kept: stops BB fading it out",
  },
];

const BEHAVIOUR: Setting[] = [
  {
    key: "enabled",
    label: "Show the minimap",
    text: "A strip along the right edge, one rectangle per message",
  },
  {
    key: "hideToc",
    label: "Hide the thread-index button",
    text: "On removes it; off moves it left of the strip",
  },
  {
    key: "hideWhenFits",
    label: "Hide when the thread fits",
    text: "Gone while there is nothing to scroll, like the scrollbar",
  },
  {
    key: "loadHistory",
    label: "Load the whole history",
    text: "Reads every older page too; off reads the newest, far cheaper",
  },
];

function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="minimap-switch" onClick={onChange} />
  );
}

/**
 * A control that previews while it is dragged and saves once, when it is released (the native `change`
 * event), when its panel closes, or 600ms after the last step as a backstop. `saved` is what is stored; the
 * preview is dropped once the stored value catches up with it, or the write fails.
 */
function usePreviewed<T extends number | string>(key: string, saved: T | undefined, send: (value: T) => Promise<unknown>) {
  const preview = usePreview()[key] as T | undefined;
  const timer = useRef(0);
  const latest = useRef({ saved, send });
  latest.current = { saved, send };
  useEffect(() => {
    if (preview !== undefined && preview === saved) clearPreview(key);
  }, [preview, saved, key]);
  const commit = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    const value = getPreview(key) as T | undefined;
    if (value === undefined) return;
    if (value === latest.current.saved) return clearPreview(key);
    latest.current.send(value).catch(() => clearPreview(key));
  }, [key]);
  useEffect(() => commit, [commit]);
  const change = (value: T) => {
    setPreview(key, value);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(commit, COMMIT_AFTER_MS);
  };
  return { shown: preview, change, commit };
}

/**
 * Arrow keys, Home and End move between the tabs or radios of one group, as the roles promise; only the selected one is a
 * tab stop. Tabs follow focus (the arrow selects), which is what these small groups want.
 */
const rove = (event: React.KeyboardEvent<HTMLElement>, role: "tab" | "radio") => {
  const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
  if (!keys.includes(event.key)) return;
  const all = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(`[role="${role}"]:not(:disabled)`));
  const at = all.indexOf(document.activeElement as HTMLElement);
  if (at < 0) return;
  event.preventDefault();
  const to = event.key === "Home" ? 0 : event.key === "End" ? all.length - 1 : (at + (event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1) + all.length) % all.length;
  all[to]!.focus();
  all[to]!.click();
};

function Toggle({ item, dim, indent }: { item: Setting; dim?: boolean; indent?: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const on = options[item.key];
  return (
    <div className="minimap-opt" data-dim={dim ? "" : undefined} data-indent={indent}>
      <div className="minimap-opt-text">
        <b>{item.label}</b>
        <span title={item.text}>{item.text}</span>
      </div>
      <Switch on={on} label={item.label} disabled={dim} onChange={() => void rpc.call("set_setting", { key: item.key, value: !on }).catch(() => {})} />
    </div>
  );
}

/** A two-way choice kept in a boolean setting, drawn as a pair of tabs: `no` is its label for off, `yes` for on. */
function Segment({ item, no, yes, dim, indent }: { item: Setting; no: string; yes: string; dim?: boolean; indent?: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const on = options[item.key];
  const pick = (value: boolean) => {
    if (!dim && value !== on) void rpc.call("set_setting", { key: item.key, value }).catch(() => {});
  };
  return (
    <div className="minimap-opt" data-stack="" data-dim={dim ? "" : undefined} data-indent={indent}>
      <div className="minimap-opt-text">
        <b>{item.label}</b>
        <span title={item.text}>{item.text}</span>
      </div>
      <div className="minimap-seg" role="radiogroup" aria-label={item.label} onKeyDown={(event) => rove(event, "radio")}>
        {[no, yes].map((name, index) => (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={on === (index === 1)}
            tabIndex={on === (index === 1) ? 0 : -1}
            disabled={dim}
            className="minimap-seg-btn"
            onClick={() => pick(index === 1)}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function Slider({ label, text, unit, name, value, dim, indent }: { label: string; text: string; unit: string; name: NumberKey; value: number; dim?: boolean; indent?: number }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const [min, max] = NUMBER_RANGES[name];
  const savedValue = typeof values?.[name] === "number" ? (values[name] as number) : undefined;
  // The percentages are shown as percentages; the preview and the saved value are the raw number.
  const { shown: previewed, change, commit } = usePreviewed<number>(name, savedValue, (next) => rpc.call("set_number", { key: name, value: next }));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    input?.addEventListener("change", commit);
    return () => input?.removeEventListener("change", commit);
  }, [commit]);
  const shown = previewed ?? value;
  return (
    <div className="minimap-opt" data-stack="" data-dim={dim ? "" : undefined} data-indent={indent}>
      <div className="minimap-opt-text">
        <b>{label}</b>
        <span title={text}>{text}</span>
      </div>
      <div className="minimap-slide">
        <input
          ref={ref}
          type="range"
          className="minimap-range"
          aria-label={label}
          min={min}
          max={max}
          value={shown}
          disabled={dim}
          style={{ "--minimap-fill": `${((shown - min) / (max - min)) * 100}%` } as React.CSSProperties}
          onChange={(event) => change(Number(event.target.value))}
        />
        <output>
          {shown}
          {unit}
        </output>
      </div>
    </div>
  );
}

/** How much of the panel must stay on screen, so it can always be grabbed again. */
const KEEP = 48;

interface Spot {
  x: number;
  y: number;
}

/** Where the panel appears: the top left corner of the chat window, the thread's timeline. */
function home(): Spot {
  const pane = document.querySelector("[data-page-scroll-viewport]");
  const rect = pane?.getBoundingClientRect();
  return rect && rect.width > 0 ? { x: rect.left + 16, y: rect.top + 16 } : { x: 16, y: 64 };
}

const clampSpot = (spot: Spot, width: number): Spot => ({
  x: Math.min(window.innerWidth - KEEP, Math.max(KEEP - width, spot.x)),
  y: Math.min(window.innerHeight - KEEP, Math.max(0, spot.y)),
});

/** Where the panel is, and the handlers that move it. It starts at the chat window's top left on every open. */
function useDrag() {
  const box = useRef<HTMLDivElement>(null);
  const [spot, setSpot] = useState<Spot>(home);
  const grab = useRef<{ dx: number; dy: number; width: number } | null>(null);
  const onDown = (event: React.PointerEvent<HTMLElement>) => {
    const el = box.current;
    // A press on the close button is a click, not a drag.
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
  // A smaller window must not strand a panel placed in a larger one.
  useEffect(() => {
    const fit = () => setSpot((now) => clampSpot(now, box.current?.offsetWidth ?? 600));
    window.addEventListener(SIZED, fit);
    return () => window.removeEventListener(SIZED, fit);
  }, []);
  return { box, spot, handlers: { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp } };
}

/** The text colour as "#rrggbb", for a colour input that has no saved colour yet. */
function themeColor(from: Element | null): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !from) return "#808080";
  // A canvas keeps oklab and color-mix() colours as written, so read back the pixel it paints.
  ctx.fillStyle = "#808080";
  ctx.fillStyle = getComputedStyle(from).color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

/** A colour that can be picked, with a button to go back to the theme's own. */
function ColorPick({ name, label, value, dim, from }: { name: ColorKey; label: string; value: string; dim?: boolean; from: () => Element | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values } = useSettings();
  const saved = typeof values?.[name] === "string" ? (values[name] as string) : "";
  const send = (next: string) => rpc.call("set_color", { key: name, value: next });
  const { shown: previewed, change, commit } = usePreviewed<string>(name, saved, send);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = ref.current;
    input?.addEventListener("change", commit);
    return () => input?.removeEventListener("change", commit);
  }, [commit]);
  const shown = previewed ?? (value || themeColor(from()));
  return (
    <div className="minimap-color-row">
      <button
        type="button"
        className="minimap-reset"
        disabled={dim || (!value && previewed === undefined)}
        onClick={() => (clearPreview(name), void send("").catch(() => {}))}
      >
        Theme
      </button>
      <input
        ref={ref}
        type="color"
        className="minimap-color"
        aria-label={label}
        value={shown}
        disabled={dim}
        onChange={(event) => change(event.target.value)}
      />
    </div>
  );
}

function ColorRow({ value, dim, from, indent }: { value: string; dim?: boolean; from: React.RefObject<HTMLElement | null>; indent?: number }) {
  return (
    <div className="minimap-opt" data-dim={dim ? "" : undefined} data-indent={indent}>
      <div className="minimap-opt-text">
        <b>Slider colour</b>
        <span title="Follows the theme's text colour until you pick one">Follows the theme's text colour until you pick one</span>
      </div>
      <ColorPick name="sliderColor" label="Slider colour" value={value} dim={dim} from={() => from.current} />
    </div>
  );
}

/** One kind of rectangle: whether it is drawn, and its colour. */
function BlockRow({ kind, name, note, dim }: { kind: Kind; name: string; note: string; dim?: boolean }) {
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const keys = BLOCK_KEYS[kind];
  const on = options[keys.show];
  const off = dim || !on;
  return (
    <div className="minimap-opt" data-dim={dim ? "" : undefined}>
      <div className="minimap-opt-text">
        <b>{name}</b>
        <span title={note}>{note}</span>
      </div>
      <ColorPick
        name={keys.color as ColorKey}
        label={`${name} colour`}
        value={options.colors[kind]}
        dim={off}
        from={() => document.querySelector(`.minimap-ink[data-kind="${kind}"]`)}
      />
      <Switch on={on} label={`Show ${name.toLowerCase()}`} disabled={dim} onChange={() => void rpc.call("set_setting", { key: keys.show, value: !on }).catch(() => {})} />
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
      className="minimap-reset"
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

/** The tabs and the settings under them: the floating panel and BB's settings page both show this. */
function Content({ box, focusOnOpen }: { box: React.RefObject<HTMLElement | null>; focusOnOpen?: boolean }) {
  const options = useOptions();
  const uid = useId();
  const tablist = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnOpen) tablist.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [focusOnOpen]);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Behaviour");
  const [groups, setGroups] = useState<Record<string, string>>({});
  const names = GROUPS[tab];
  /** The page shown: the group chosen inside the tab, or the tab itself. */
  const page = names ? (names.includes(groups[tab] ?? "") ? groups[tab]! : names[0]!) : tab;
  const off = !options.enabled;
  const sliderOff = off || !options.showOutline;
  const noteOff = off || !options.hoverPreview;
  const pane = `${uid}-pane`;
  return (
    <>
      <div ref={tablist} className="minimap-tabs" role="tablist" aria-label="Minimap settings" onKeyDown={(event) => rove(event, "tab")}>
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${uid}-${name}`}
            aria-selected={tab === name}
            aria-controls={pane}
            tabIndex={tab === name ? 0 : -1}
            className="minimap-tab"
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="minimap-panel-body" role="tabpanel" id={pane} aria-labelledby={`${uid}-${tab}`}>
        {names && (
          <div className="minimap-seg minimap-groups" role="tablist" aria-label={`${tab} groups`} onKeyDown={(event) => rove(event, "tab")}>
            {names.map((name) => (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={page === name}
                aria-controls={pane}
                tabIndex={page === name ? 0 : -1}
                className="minimap-seg-btn"
                onClick={() => setGroups((now) => ({ ...now, [tab]: name }))}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        {tab === "Behaviour" && (
          <>
            {BEHAVIOUR.map((item) => (
              <Toggle key={item.key} item={item} dim={off && item.key !== "enabled"} />
            ))}
          </>
        )}
        {page === "Scrollbar" && (
          <>
            {SCROLLBAR.map((item) => (
              <Toggle key={item.key} item={item} dim={off || (item.key === "keepScrollbar" && options.hideScrollbar)} indent={item.key === "keepScrollbar" ? 1 : undefined} />
            ))}
          </>
        )}
        {page === "Size" && (
          <>
            <Slider label="Width" text="6 to 120 pixels" unit="px" name="width" value={options.width} dim={off} />
            <Toggle
              item={{ key: "keepNarrow", label: "Keep on narrow windows", text: "Instead of handing back to the scrollbar when there is no room" }}
              dim={off}
            />
            <Slider label="Narrow width" text="4 to 60 pixels, used when there is no room" unit="px" name="narrowWidth" value={options.narrowWidth} dim={off || !options.keepNarrow} indent={1} />
          </>
        )}
        {page === "Fade" && (
          <>
            <Slider label="Opacity" text="How solid the rectangles are" unit="%" name="opacity" value={Math.round(options.opacity * 100)} dim={off} />
            <Toggle
              item={{ key: "fadeIdle", label: "Fade when not hovered", text: "Dims the rectangles until hovered; the slider stays solid" }}
              dim={off}
            />
            <Slider
              label="Idle opacity"
              text="How faint they get when not hovered"
              unit="%"
              name="idleOpacity"
              value={Math.round(options.idleOpacity * 100)}
              dim={off || !options.fadeIdle}
              indent={1}
            />
          </>
        )}
        {page === "Shade" && (
          <>
            <Toggle item={{ key: "edgeShadow", label: "Shade the thread beside the strip", text: "A soft darkening from the strip's edge over the thread" }} dim={off} />
            <Toggle item={{ key: "edgeDarkOnly", label: "No shade on a light theme", text: "Off while the theme is light, where it looks heavy" }} dim={off || !options.edgeShadow} indent={1} />
            <Segment item={{ key: "edgeRight", label: "Cast from", text: "The strip's own edge, or the window's, crossing the strip" }} no="Strip edge" yes="Right edge" dim={off || !options.edgeShadow} indent={1} />
            <Segment item={{ key: "edgeTheme", label: "Colour", text: "Darkens with black, or fades into the theme's background" }} no="Black" yes="Theme" dim={off || !options.edgeShadow} indent={1} />
            <Segment item={{ key: "edgeOver", label: "Layer", text: "Under the strip's rectangles, or over them" }} no="Under" yes="Over" dim={off || !options.edgeShadow} indent={1} />
            <Slider label="Shade strength" text="How dark it is, 0 to 100" unit="%" name="edgeStrength" value={Math.round(options.edgeStrength * 100)} dim={off || !options.edgeShadow} indent={1} />
            <Slider label="Shade reach" text="As a share of the strip's width, 25 to 400" unit="%" name="edgeReach" value={options.edgeReach} dim={off || !options.edgeShadow} indent={1} />
          </>
        )}
        {tab === "Scrolling" && (
          <>
            <Segment item={{ key: "clickSmooth", label: "A click on the strip", text: "Glides to the place, or jumps there" }} no="Jumps" yes="Glides" dim={off} />
            <Segment item={{ key: "wheelSmooth", label: "The wheel over the strip", text: "Glides, with steps adding up, or jumps a step at a time" }} no="Jumps" yes="Glides" dim={off} />
            <Slider label="Wheel speed" text="Distance per wheel step; 200 is twice the thread's own, 25 to 1000" unit="%" name="wheelSpeed" value={options.wheelSpeed} dim={off} />
          </>
        )}
        {tab === "Blocks" && (
          <>
            {BLOCKS.map((block) => (
              <BlockRow key={block.kind} kind={block.kind} name={block.name} note={block.note} dim={off} />
            ))}
          </>
        )}
        {page === "Preview" && (
          <>
            <Toggle
              item={{ key: "hoverPreview", label: "Preview on hover", text: "A note beside the strip with the start of the message under the pointer" }}
              dim={off}
            />
            <Slider label="Context rows" text="Rows above and below the pointer's, 0 to 6" unit="" name="hoverContext" value={options.hoverContext} dim={noteOff} indent={1} />
            <Slider label="Text lines" text="1 to 6 lines of each message" unit="" name="hoverLines" value={options.hoverLines} dim={noteOff} indent={1} />
            <Slider label="Hover delay" text="Least time between rows, 0 to 500 ms" unit="ms" name="hoverDelay" value={options.hoverDelay} dim={noteOff} indent={1} />
          </>
        )}
        {page === "Glide" && (
          <>
            <Toggle
              item={{ key: "hoverAnimate", label: "Animate the note", text: "Glides from row to row; off swaps the text at once" }}
              dim={noteOff}
            />
            <Slider label="Glide time" text="Between rows, 0 to 1000 ms; 0 is instant" unit="ms" name="hoverSlideMs" value={options.hoverSlideMs} dim={noteOff || !options.hoverAnimate} indent={1} />
            <Slider label="Glide softness" text="Softening at the start of a long glide, 0 to 12" unit="px" name="hoverBlur" value={options.hoverBlur} dim={noteOff || !options.hoverAnimate || options.hoverSlideMs === 0} indent={1} />
          </>
        )}
        {tab === "Slider" && (
          <>
            <Toggle
              item={{ key: "showOutline", label: "Show the viewport slider", text: "The box over what is on screen; drag it to scrub" }}
              dim={off}
            />
            <Segment item={{ key: "sliderRound", label: "Corners", text: "Square corners, or curved ones" }} no="Square" yes="Round" dim={sliderOff} indent={1} />
            <Slider label="Thickness" text="1 to 6 pixels" unit="px" name="sliderThickness" value={options.sliderThickness} dim={sliderOff} indent={1} />
            <Slider
              label="Opacity"
              text="Fading the strip never changes it"
              unit="%"
              name="sliderOpacity"
              value={Math.round(options.sliderOpacity * 100)}
              dim={sliderOff}
              indent={1}
            />
            <ColorRow value={options.sliderColor} dim={sliderOff} from={box} indent={1} />
          </>
        )}
      </div>
    </>
  );
}

function Body() {
  const { box, spot, handlers } = useDrag();
  const style = { "--minimap-float": FLOAT, "--minimap-row": ROW, "--minimap-pos": ABS, "--minimap-rel": REL, left: spot.x, top: spot.y } as React.CSSProperties;
  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPanelOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, []);
  return (
    <div ref={box} className="minimap-panel" role="dialog" aria-label="Minimap settings" style={style}>
      <div className="minimap-titlebar" {...handlers} title="Drag to move">
        <Icon name="ListView" />
        <b>Minimap settings</b>
        <ResetAll />
        <button type="button" aria-label="Close" onClick={() => setPanelOpen(false)}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <Content box={box} focusOnOpen />
    </div>
  );
}

/** The same settings as a section of BB's settings page, in the page's own flow instead of floating. */
export function SettingsPage() {
  const box = useRef<HTMLDivElement>(null);
  const style = { "--minimap-float": FLOAT, "--minimap-row": ROW, "--minimap-pos": ABS, "--minimap-rel": REL } as React.CSSProperties;
  return (
    <div ref={box} className="minimap-panel" data-page="" style={style}>
      <div className="minimap-titlebar" data-page="">
        <b>Settings</b>
        <ResetAll />
      </div>
      <Content box={box} />
    </div>
  );
}

/** The settings, floating over the chat so a change can be watched on the strip as it is made. */
export function Panel() {
  return usePanelOpen() ? <Body /> : null;
}
