import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { OwnerState } from "../server";
import { CloseIcon, UserIcon } from "./Icons";
import { leftLabel, sinceLabel } from "./labels";
import { useNow, type Rpc } from "./state";

type Share = NonNullable<OwnerState["share"]>;

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className="guest-view-switch" data-on={on ? "true" : "false"} disabled={disabled} onClick={() => onChange(!on)}>
      <span className="guest-view-switch-knob" />
    </button>
  );
}

/** The settings overlay: who is connected (with Kick), when the link ends, and whether newcomers see earlier messages. */
export function Config({ share, threadId, rpc, set, onClose }: { share: Share; threadId: string; rpc: Rpc; set(next: OwnerState): void; onClose(): void }) {
  // The labels here (who has been connected how long, time left) move by the minute, not by the second.
  const now = useNow(30_000);
  const [hours, setHours] = useState(() => String(Math.min(168, Math.max(1, Math.round((share.expiresAt - now) / 3_600_000)))));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const run = (call: Promise<OwnerState>) => {
    setBusy(true);
    setError(null);
    call
      .then(set)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
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
            <button type="button" className="guest-view-button" disabled={busy || !valid} onClick={() => run(rpc.call("configure", { threadId, expiryHours: Math.round(parsed) }))}>
              Set
            </button>
          </div>
          <div className="guest-view-muted guest-view-fine">1 to 168 hours. New links start at the Link lifetime in the plugin's settings.</div>
        </section>

        <section className="guest-view-section">
          <div className="guest-view-form-row">
            <span>New guests see previous history</span>
            <span className="guest-view-spacer" />
            <Switch on={share.showHistory} label="New guests see previous history" onChange={(next) => run(rpc.call("configure", { threadId, showHistory: next }))} />
          </div>
          <div className="guest-view-muted guest-view-fine">Off: someone who opens the link later only sees messages from then on. Guests already connected keep what they have.</div>
        </section>

        <section className="guest-view-section">
          <div className="guest-view-form-row">
            <span>Guests know about other guests</span>
            <span className="guest-view-spacer" />
            <Switch on={share.showGuests} label="Guests know about other guests" onChange={(next) => run(rpc.call("configure", { threadId, showGuests: next }))} />
          </div>
          <div className="guest-view-muted guest-view-fine">On: a guest's page says how many guests are connected. Off: it shows only the icon, and a guest only ever sees their own prompts.</div>
        </section>

        <section className="guest-view-section">
          <div className="guest-view-form-row">
            <span>Guests see each other's prompts</span>
            <span className="guest-view-spacer" />
            <Switch on={share.showPrompts && share.showGuests} disabled={!share.showGuests} label="Guests see each other's prompts" onChange={(next) => run(rpc.call("configure", { threadId, showPrompts: next }))} />
          </div>
          <div className="guest-view-muted guest-view-fine">On: each guest's list shows everyone's prompts as "name: message Sent". Off: a guest only sees their own. Needs "Guests know about other guests". Guests are never told whether you used or dismissed a prompt.</div>
        </section>

        <section className="guest-view-section">
          <div className="guest-view-form-row">
            <span>Show guests the model</span>
            <span className="guest-view-spacer" />
            <Switch on={share.showModel} label="Show guests the model" onChange={(next) => run(rpc.call("configure", { threadId, showModel: next }))} />
          </div>
          <div className="guest-view-muted guest-view-fine">On: the guest's composer shows the model and effort the agent runs on, like "Sonnet 5.5 High". Off (the default): it does not.</div>
        </section>

        {error ? <div className="guest-view-error">{error}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
