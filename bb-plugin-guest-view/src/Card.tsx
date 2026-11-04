import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { experimental_copyToClipboard as copyToClipboard, experimental_Icon as Icon, useComposer } from "@get-bb/plugin-sdk/app";
import type { OwnerHistoryItem, OwnerPrompt, OwnerState } from "../server";
import { Config } from "./Config";
import { elapsedLabel, leftLabel } from "./labels";
import { attributed } from "./model";
import { ArrowDownIcon, CheckIcon, ChevronDownIcon, ClockIcon, CloseIcon, CopyIcon, LinkIcon, MessageIcon, SlidersIcon, StopIcon, ShareIcon, TimerIcon } from "./Icons";
import { SplitButton } from "./SplitButton";
import { useNow, useOwnerState, type Rpc } from "./state";

/** The time a link has been live, ticking once a second. Only this text renders on each tick, not the card around it. */
function Elapsed({ since }: { since: number }) {
  const now = useNow(1000);
  return <span className="guest-view-time">{elapsedLabel(since, now)}</span>;
}

function IconButton({ label, onClick, children, active }: { label: string; onClick(): void; children: ReactNode; active?: boolean }) {
  return (
    <button type="button" className="guest-view-icon-button" aria-label={label} title={label} data-active={active ? "true" : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function Button({ label, icon, iconNode, onClick, primary, busy }: { label: string; icon?: string; iconNode?: ReactNode; onClick(): void; primary?: boolean; busy?: boolean }) {
  return (
    <button type="button" className={primary ? "guest-view-button guest-view-button-primary" : "guest-view-button"} onClick={onClick} disabled={busy}>
      {iconNode ?? (icon ? <Icon name={icon} className="guest-view-button-icon" /> : null)}
      {label}
    </button>
  );
}

/**
 * Text cut at a few lines (set in CSS) until clicked. `cut` is true only when something is
 * cut off, so a short prompt gets no chevron; the width is watched, so it follows resizes.
 */
function useClamp(text: string) {
  const [expanded, setExpanded] = useState(false);
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || expanded) return;
    const measure = () => setOver(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded, text]);
  const cut = over || expanded;
  const toggle = () => {
    if (cut) setExpanded(!expanded);
  };
  return { ref, expanded, cut, toggle };
}

function MoreButton({ clamp }: { clamp: ReturnType<typeof useClamp> }) {
  if (!clamp.cut) return null;
  return (
    <button type="button" className="guest-view-more" data-open={clamp.expanded ? "true" : "false"} aria-label={clamp.expanded ? "Show less" : "Show all"} aria-expanded={clamp.expanded} onClick={clamp.toggle}>
      <ChevronDownIcon />
    </button>
  );
}

/** An icon-only Copy button: it copies the text, shows a check for a moment, and changes nothing else. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void copyToClipboard({ text }).then((ok) => {
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1500);
    });
  return (
    <button type="button" className="guest-view-button guest-view-button-square" aria-label={copied ? "Copied" : "Copy"} title={copied ? "Copied" : "Copy"} onClick={copy}>
      {copied ? <CheckIcon className="guest-view-button-icon" /> : <CopyIcon className="guest-view-button-icon" />}
    </button>
  );
}

/** One guest prompt waiting for the owner: its text (cut at four lines until clicked) and Use, Copy, Dismiss in a column to its right. */
function PromptRow({ prompt, rpc, threadId, set }: { prompt: OwnerPrompt; rpc: Rpc; threadId: string; set(next: OwnerState): void }) {
  const composer = useComposer();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clamp = useClamp(prompt.text);

  const act = (method: "use_prompt" | "dismiss_prompt", after?: () => void) => {
    setBusy(true);
    setError(null);
    rpc
      .call(method, { threadId, promptId: prompt.id })
      .then((next) => {
        // Only a prompt this page really took is put in the composer (another BB page may have used it first).
        after?.();
        set(next);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  // Use puts the text in the owner's composer to read, change and send themselves; nothing goes to the agent from here.
  // The button inserts the bare text; its menu offers the same text told as "<name> says: ...", the owner's choice each time.
  const use = (text: string) =>
    act("use_prompt", () => {
      const lead = composer.isEmpty ? "" : "\n\n";
      composer.insert(lead + text, { at: "end" });
      composer.focus();
    });
  const told = attributed(prompt.name, prompt.text);

  return (
    <div className="guest-view-prompt">
      <div className="guest-view-prompt-main">
        <div className="guest-view-prompt-head">
          <Icon name="UserRound" className="guest-view-prompt-icon" />
          <span className="guest-view-prompt-name">{prompt.name}</span>
          <span className="guest-view-muted">(guest) suggests</span>
          <span className="guest-view-spacer" />
          <MoreButton clamp={clamp} />
        </div>
        <div ref={clamp.ref} className="guest-view-prompt-text" data-lines="4" data-expanded={clamp.expanded ? "true" : "false"} data-cut={clamp.cut ? "true" : "false"} onClick={clamp.toggle}>
          {prompt.text}
        </div>
        {error ? <div className="guest-view-error">{error}</div> : null}
      </div>
      <div className="guest-view-actions">
        <SplitButton
          busy={busy}
          onMain={() => use(prompt.text)}
          moreLabel="More ways to use this prompt"
          choices={[{ label: "Use with the name", hint: told.replace(/\s+/g, " "), run: () => use(told) }]}
        >
          <ArrowDownIcon className="guest-view-button-icon" />
          Use
        </SplitButton>
        <CopyButton text={prompt.text} />
        <button type="button" className="guest-view-button guest-view-button-square" aria-label="Dismiss" title="Dismiss" disabled={busy} onClick={() => act("dismiss_prompt")}>
          <CloseIcon className="guest-view-button-icon" />
        </button>
      </div>
    </div>
  );
}

/** A prompt already used or dismissed: kept in History, text cut at two lines. */
function HistoryRow({ item }: { item: OwnerHistoryItem }) {
  const clamp = useClamp(item.text);
  return (
    <div className="guest-view-history-row">
      <div className="guest-view-prompt-head">
        <Icon name="UserRound" className="guest-view-prompt-icon" />
        <span className="guest-view-prompt-name">{item.name}</span>
        <span className="guest-view-muted">{item.status === "used" ? "Used" : "Dismissed"}</span>
        <span className="guest-view-spacer" />
        <MoreButton clamp={clamp} />
        <CopyButton text={item.text} />
      </div>
      <div ref={clamp.ref} className="guest-view-prompt-text" data-lines="2" data-expanded={clamp.expanded ? "true" : "false"} data-cut={clamp.cut ? "true" : "false"} onClick={clamp.toggle}>
        {item.text}
      </div>
    </div>
  );
}

/** The History list: oldest first, so the newest is at the bottom, and it opens scrolled there. */
function HistoryList({ history }: { history: OwnerHistoryItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [history.length]);
  return (
    <div className="guest-view-history-list" ref={ref}>
      {history.map((item) => (
        <HistoryRow key={item.id} item={item} />
      ))}
    </div>
  );
}

/** Above the thread's composer: the live share, guest prompts waiting for approval, and setup problems. */
export function GuestCard() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const { state, rpc, set } = useOwnerState(threadId);
  const [copied, setCopied] = useState(false);
  const [config, setConfig] = useState(false);
  // The expanded part stays closed until the owner opens it: a new prompt only adds to the pending count.
  const [openFor, setOpenFor] = useState<string | null>(null);
  // History inside it is only ever opened by hand, and closes with it.
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  if (!threadId || !state) return null;
  const { share, prompts, history, error, install, starting } = state;
  if (!share && !starting && !error && prompts.length === 0) return null;
  const waiting = prompts.length;
  const open = openFor === threadId;
  const historyOpen = open && historyFor === threadId;
  const toggle = () => {
    setOpenFor(open ? null : threadId);
    if (open) setHistoryFor(null);
  };

  const copy = (text: string) =>
    void copyToClipboard({ text }).then((ok) => {
      setCopied(ok);
      if (ok) setTimeout(() => setCopied(false), 1500);
    });

  return (
    <div className="guest-view-card">
      {starting ? (
        <div className="guest-view-line">
          <ShareIcon className="guest-view-line-icon" />
          <span>Starting the guest link…</span>
        </div>
      ) : null}
      {share ? (
        <div className="guest-view-row">
          <div
            className="guest-view-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={open}
            onClick={toggle}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggle();
              }
            }}
          >
            <span className="guest-view-live">
              <ShareIcon />
            </span>
            <span className="guest-view-meta" title="Guests connected now">
              {share.viewers === 1 ? "1 guest" : `${share.viewers} guests`}
            </span>
            <span className="guest-view-meta" title="How long this link has been live, of how long it lasts">
              <TimerIcon />
              <Elapsed since={share.createdAt} />
              <span>of</span>
              <span className="guest-view-time">{leftLabel(share.expiresAt, share.createdAt)}</span>
            </span>
            {waiting > 0 ? (
              <span className="guest-view-meta guest-view-pending" title="Guest prompts waiting for you. Click to open them.">
                <MessageIcon />
                {waiting} pending
              </span>
            ) : null}
            <span className="guest-view-spacer" />
            <span className="guest-view-chevron" data-open={open ? "true" : "false"}>
              <ChevronDownIcon />
            </span>
          </div>
          <div className="guest-view-buttons">
            <IconButton label={copied ? "Link copied" : "Copy guest link"} onClick={() => copy(share.url)} active={copied}>
              {copied ? <CheckIcon /> : <LinkIcon />}
            </IconButton>
            <IconButton label="Guests and settings" onClick={() => setConfig(true)} active={config}>
              <SlidersIcon />
            </IconButton>
            <IconButton label="Stop sharing" onClick={() => void rpc.call("stop", { threadId }).then(set).catch(() => {})}>
              <StopIcon />
            </IconButton>
          </div>
        </div>
      ) : null}
      {share && config ? <Config share={share} threadId={threadId} rpc={rpc} set={set} onClose={() => setConfig(false)} /> : null}
      {error && !starting ? (
        <div className="guest-view-problem">
          <div className="guest-view-line">
            <Icon name="Info" className="guest-view-line-icon" />
            <span>{install ? "Guest View needs cloudflared to make a public link." : error}</span>
            <span className="guest-view-spacer" />
            <Button label="Close" onClick={() => void rpc.call("clear_error", { threadId }).then(set).catch(() => {})} />
          </div>
          {install ? (
            <>
              <div className="guest-view-muted">{install.text}</div>
              <pre className="guest-view-command">{install.command}</pre>
              <div className="guest-view-actions">
                <Button label={copied ? "Copied" : "Copy command"} icon="Copy" onClick={() => copy(install.command)} />
                {install.canInstall ? (
                  <Button
                    label={installing ? "Installing…" : "Install it for me"}
                    icon="Check"
                    busy={installing}
                    onClick={() => {
                      setInstalling(true);
                      setInstallError(null);
                      rpc
                        .call("install_cloudflared", { threadId })
                        .then(set)
                        .catch((e: unknown) => setInstallError(e instanceof Error ? e.message : String(e)))
                        .finally(() => setInstalling(false));
                    }}
                  />
                ) : null}
                <a className="guest-view-link" href={install.url} target="_blank" rel="noreferrer">
                  Cloudflare's download page
                </a>
              </div>
              {install.canInstall ? <div className="guest-view-muted">Install downloads a pinned cloudflared release from GitHub, checks its SHA-256 and puts it in ~/.local/bin/cloudflared. Then share again.</div> : null}
              {installError ? <div className="guest-view-error">{installError}</div> : null}
            </>
          ) : null}
        </div>
      ) : null}
      {share && open ? (
        <div className="guest-view-expanded">
          {history.length > 0 ? (
            <div className="guest-view-history">
              <button type="button" className="guest-view-history-head" aria-expanded={historyOpen} onClick={() => setHistoryFor(historyOpen ? null : threadId)}>
                <ClockIcon />
                <span>History</span>
                <span className="guest-view-muted">{history.length}</span>
                <span className="guest-view-spacer" />
                <span className="guest-view-chevron" data-open={historyOpen ? "true" : "false"} data-shown="true">
                  <ChevronDownIcon />
                </span>
              </button>
              {historyOpen ? <HistoryList history={history} /> : null}
            </div>
          ) : null}
          {waiting > 0 ? (
            <div className="guest-view-approval">
              {prompts.map((prompt) => (
                <PromptRow key={prompt.id} prompt={prompt} rpc={rpc} threadId={threadId} set={set} />
              ))}
            </div>
          ) : (
            <div className="guest-view-empty">{history.length > 0 ? "No messages waiting" : "No messages received yet"}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
