import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { GuestsSee, OwnerState } from "../server";
import { CloseIcon, UserIcon } from "./Icons";
import { leftLabel, sinceLabel } from "./labels";
import { messageOf, useNow, type Rpc } from "./state";

type Share = NonNullable<OwnerState["share"]>;

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="guest-view-switch" data-on={on ? "true" : "false"} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="guest-view-switch-knob" />
    </button>
  );
}

/** One setting of the link: its label and control on one row, a note under it. */
function Setting({ id, label, hint, children }: { id?: string; label: string; hint: string; children: ReactNode }) {
  return (
    <section className="guest-view-section">
      <div className="guest-view-form-row">
        <span id={id}>{label}</span>
        <span className="guest-view-spacer" />
        {children}
      </div>
      <div className="guest-view-muted guest-view-fine">{hint}</div>
    </section>
  );
}

/** What guests learn about each other, from least to most. */
const SEE: { value: GuestsSee; label: string; hint: string }[] = [
  { value: "own", label: "Only their own", hint: "A guest's page shows the icon with no count, and only the prompts that guest sent." },
  { value: "count", label: "How many", hint: "A guest's page says how many guests are connected. A guest only sees their own prompts." },
  { value: "prompts", label: "How many and prompts", hint: "A guest's page says how many are connected, and each guest's list shows everyone's prompts as \"name: message Sent\". Guests are never told whether you used or dismissed a prompt." },
];

/** The settings overlay: who is connected (with Kick), when the link ends, and whether newcomers see earlier messages. */
export function Config({ share, threadId, rpc, set, onClose }: { share: Share; threadId: string; rpc: Rpc; set(next: OwnerState): void; onClose(): void }) {
  // The labels here (who has been connected how long, time left) move by the minute, not by the second.
  const now = useNow(30_000);
  const [hours, setHours] = useState(() => String(Math.min(168, Math.max(1, Math.round((share.expiresAt - now) / 3_600_000)))));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The card hands in a new function on every render, and each owner-state push renders it. The effect below must not
  // run again for that: it focuses the dialog, which would take focus from the field being typed in.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey, true);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, []);

  const run = (call: Promise<OwnerState>) => {
    setBusy(true);
    setError(null);
    call
      .then(set)
      .catch((e: unknown) => setError(messageOf(e)))
      .finally(() => setBusy(false));
  };
  /** Changes one or more settings of this link. */
  const configure = (change: { expiryHours?: number; showHistory?: boolean; guestsSee?: GuestsSee; showModel?: boolean }) => run(rpc.call("configure", { threadId, ...change }));
  const parsed = Number(hours);
  const valid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 168;

  return createPortal(
    <div className="guest-view-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="guest-view-dialog" role="dialog" aria-modal="true" aria-label="Guest View settings" ref={panel} tabIndex={-1}>
        <div className="guest-view-dialog-head">
          <span className="guest-view-strong">Guest View</span>
          <span className="guest-view-spacer" />
          <button type="button" className="guest-view-icon-button" aria-label="Close" title="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <section className="guest-view-section">
          <div className="guest-view-heading">Guests · {share.guests.length}</div>
          {share.guests.length === 0 ? <div className="guest-view-muted">Nobody is connected right now.</div> : null}
          {share.guests.map((guest) => (
            <div className="guest-view-guest" key={guest.id}>
              <UserIcon className="guest-view-line-icon" />
              <span className="guest-view-guest-name">{guest.name}</span>
              <span className="guest-view-muted">{sinceLabel(guest.since, now)}</span>
              <span className="guest-view-spacer" />
              <button type="button" className="guest-view-button" disabled={busy} onClick={() => run(rpc.call("kick", { threadId, guestId: guest.id }))}>
                Kick
              </button>
            </div>
          ))}
          {share.guests.length > 0 ? <div className="guest-view-muted guest-view-fine">A guest who was kicked can come back by clearing their browser data. Stop sharing and share again to be sure.</div> : null}
        </section>

        <section className="guest-view-section">
          <div className="guest-view-heading">Link expires</div>
          <div className="guest-view-form-row">
            <span className="guest-view-muted">In {leftLabel(share.expiresAt, now)}. Set it to</span>
            <input
              className="guest-view-number"
              type="number"
              min={1}
              max={168}
              step={1}
              value={hours}
              aria-label="Hours until the link expires"
              onChange={(event) => setHours(event.target.value)}
            />
            <span className="guest-view-muted">h from now</span>
            <button type="button" className="guest-view-button" disabled={busy || !valid} onClick={() => configure({ expiryHours: Math.round(parsed) })}>
              Set
            </button>
          </div>
          <div className="guest-view-muted guest-view-fine">1 to 168 hours. New links start at the Link lifetime in the plugin's settings.</div>
        </section>

        <Setting label="New guests see previous history" hint="Off: someone who opens the link later only sees messages from then on. Guests already connected keep what they have.">
          <Switch on={share.showHistory} label="New guests see previous history" onChange={(next) => configure({ showHistory: next })} />
        </Setting>

        <Setting id="guest-view-see" label="Guests see about each other" hint={SEE.find((option) => option.value === share.guestsSee)?.hint ?? ""}>
          <div className="guest-view-choice" role="radiogroup" aria-labelledby="guest-view-see">
            {SEE.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={share.guestsSee === option.value}
                className="guest-view-choice-item"
                data-on={share.guestsSee === option.value ? "true" : "false"}
                disabled={busy}
                onClick={() => share.guestsSee !== option.value && configure({ guestsSee: option.value })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Setting>

        <Setting label="Show guests the model" hint={'On: the guest\'s composer shows the model and effort the agent runs on, like "Sonnet 5.5 High". Off (the default): it does not.'}>
          <Switch on={share.showModel} label="Show guests the model" onChange={(next) => configure({ showModel: next })} />
        </Setting>

        {error ? <div className="guest-view-error">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
