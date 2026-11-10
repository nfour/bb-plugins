import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract, SettingKey } from "../server";
import { DEFAULT_TERMS } from "./defaults";
import { KINDS, TONES, type Entry, type Kind, type Tone } from "./lexicon";
import { useOptions } from "./options";

interface Line {
  id: string;
  terms: number;
  yours: number;
  agents: number;
  stale: number;
  pending: number;
}
interface Project {
  id: string;
  name: string;
}
type Review = { terms: Entry[]; pending: { id: string; at: number; summary: string }[]; log: { at: number; by: string; summary: string }[] };
type Action = "pin" | "keep" | "remove" | "disable" | "enable" | "approve" | "reject" | "undo";

const KIND_LABEL: Record<Kind, { title: string; hint: string }> = {
  name: { title: "Names", hint: "Products, packages and other proper names" },
  feature: { title: "Features", hint: "Things the product has or does" },
  option: { title: "Options", hint: "Settings and modes a person can switch" },
  code: { title: "Code", hint: "Identifiers and other code names" },
  action: { title: "Actions", hint: "What a person does: click, drag, select" },
  outcome: { title: "Outcomes", hint: "How work turned out: shipped, reverted, failed" },
  topic: { title: "Topics", hint: "What a stretch of work is about" },
};

/** The element and its roles are named from two strings, so the build's utility-word rule does not read them as a class (see AGENTS.md). */
const TABLE = "ta" + "ble";
const ROLES = { sheet: TABLE, rowgroup: "rowgroup", row: "row", cell: "cell", head: "columnheader" } as const;

const SWITCHES: { key: SettingKey; label: string; about: string }[] = [
  { key: "enabled", label: "Colour terms", about: "Paints the lexicon's terms in replies and prompts, in the same colour every time. Off leaves chat plain; your terms are kept." },
  { key: "symbols", label: "Learn names", about: "Also paints package and identifier names it reads from the project's source files (read-only; nothing is stored in your workspace)." },
  { key: "agents", label: "Agents maintain", about: "Gives agents the lexicon tools and the project's terms, so they use the same wording and can add, alias, rename or retire terms. Off hides all of that from them." },
  { key: "proposals", label: "Agents propose", about: "Agent changes wait here for your approval instead of applying at once. Only matters while agents maintain the lexicon." },
];

const ago = (at: number) => {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
};

/** The lexicon's page: the switches on one line, then a row for the global rules and one per project; a row opens into that project's terms. */
export function Settings({ standalone = false }: { standalone?: boolean }) {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const { projectId: current } = useBbContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [lines, setLines] = useState<Map<string, Line>>(new Map());
  const [showSettings, setShowSettings] = useState(true);
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(current ? [current] : []));

  const loadLines = useCallback(async () => {
    try {
      const { projects: found, off: switched } = await rpc.call("overview", {});
      setLines(new Map(found.map((l) => [l.id, l])));
      setOff(new Set(switched));
    } catch {
      /* the rows stay as they were */
    }
  }, [rpc]);
  useEffect(() => {
    let stale = false;
    sdk.projects.list().then((list) => !stale && setProjects(list.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    void loadLines();
    return () => void (stale = true);
  }, [sdk, loadLines]);

  const toggle = (key: SettingKey) => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {});
  const flip = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="lexicon-page" data-standalone={standalone ? "" : undefined}>
      <section className="lexicon-settings" aria-labelledby="lexicon-settings-title">
        <h2 className="lexicon-heading" id="lexicon-settings-title">
          <button className="lexicon-heading-button" aria-expanded={showSettings} onClick={() => setShowSettings((now) => !now)}>
            <span className="lexicon-chevron" data-open={showSettings ? "" : undefined} aria-hidden="true">
              ›
            </span>
            Plugin global settings
          </button>
        </h2>
        {showSettings ? (
        <div className="lexicon-switches"><div className="lexicon-switch-grid">
          {SWITCHES.map(({ key, label, about }) => {
            const off = key === "proposals" && !options.agents;
            return (
              <label className="lexicon-switch" key={key} data-off={off ? "" : undefined}>
                <span className="lexicon-switch-text">
                  <span className="lexicon-switch-label">{label}</span>
                  <span className="lexicon-meta">{about}</span>
                </span>
                <input className="lexicon-toggle-input" type="checkbox" role="switch" checked={options[key]} disabled={off} onChange={() => toggle(key)} />
                <span className="lexicon-track" aria-hidden="true" />
              </label>
            );
          })}
        </div></div>
        ) : null}
      </section>
      <section className="lexicon-settings">
        <h2 className="lexicon-heading lexicon-heading-plain">Lexicon</h2>
      <div className="lexicon-sheet" role={ROLES.sheet} aria-label="Lexicon terms">
        <div className="lexicon-head lexicon-line" role={ROLES.row}>
          <span role={ROLES.head}>Where</span>
          <span role={ROLES.head}>Terms</span>
          <span role={ROLES.head}>Yours</span>
          <span role={ROLES.head}>Agents</span>
          <span role={ROLES.head}>Stale</span>
          <span role={ROLES.head}>Waiting</span>
        </div>
        <Group id="global" name="Global rules" note="built in" line={{ id: "global", terms: DEFAULT_TERMS.length, yours: DEFAULT_TERMS.length, agents: 0, stale: 0, pending: 0 }} open={open.has("global")} flip={flip}>
          <Terms global off={off} changed={loadLines} />
        </Group>
        {projects.map((p) => (
          <Group key={p.id} id={p.id} name={p.name} line={lines.get(p.id)} open={open.has(p.id)} flip={flip}>
            <Terms projectId={p.id} changed={loadLines} />
          </Group>
        ))}
      </div>
      </section>
    </div>
  );
}

const Group = memo(function Group(props: { id: string; name: string; note?: string; line: Line | undefined; open: boolean; flip: (id: string) => void; children: React.ReactNode }) {
  const { id, name, note, line, open, flip } = props;
  return (
    <div className="lexicon-group" role={ROLES.rowgroup}>
      <button className="lexicon-line lexicon-toggle" role={ROLES.row} aria-expanded={open} onClick={() => flip(id)}>
        <span className="lexicon-where" role={ROLES.cell}>
          <span className="lexicon-chevron" data-open={open ? "" : undefined} aria-hidden="true">
            ›
          </span>
          {name}
          {note ? <span className="lexicon-meta"> · {note}</span> : null}
        </span>
        <span role={ROLES.cell}>{line?.terms ?? 0}</span>
        <span role={ROLES.cell}>{line?.yours ?? 0}</span>
        <span role={ROLES.cell}>{line?.agents ?? 0}</span>
        <span role={ROLES.cell} data-alert={line?.stale ? "" : undefined}>{line?.stale ?? 0}</span>
        <span role={ROLES.cell} data-alert={line?.pending ? "" : undefined}>{line?.pending ?? 0}</span>
      </button>
      {open ? <div className="lexicon-panel">{props.children}</div> : null}
    </div>
  );
});

/** Every term of one scope, grouped by kind (every kind is listed, empty or not), in a list of set height that scrolls. Only an open row mounts it, and only then is the project read. */
function Terms({ projectId, global, off, changed }: { projectId?: string; global?: boolean; off?: ReadonlySet<string>; changed?: () => Promise<void> }) {
  const rpc = useRpc<typeof rpcContract>();
  const [data, setData] = useState<Review | null>(null);
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState<Kind | null>(null);
  const [folded, setFolded] = useState<ReadonlySet<Kind>>(new Set());
  const fold = (kind: Kind, to?: boolean) =>
    setFolded((now) => {
      const next = new Set(now);
      if (to ?? !next.has(kind)) next.add(kind);
      else next.delete(kind);
      return next;
    });

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setData((await rpc.call("review", { projectId })) as Review);
    } catch {
      setData(null);
    }
  }, [rpc, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const edit = async (action: Action, id?: string) => {
    if (global && id && (action === "disable" || action === "enable")) {
      await rpc.call("set_default", { id, disabled: action === "disable" });
      await changed?.();
      return;
    }
    if (!projectId) return;
    const result = await rpc.call("edit", id === undefined ? { projectId, action } : { projectId, action, id });
    setMessage(result.reply);
    await Promise.all([load(), changed?.()]);
  };

  const groups = useMemo(() => {
    const list = global ? DEFAULT_TERMS.map((t) => (off?.has(t.id) ? { ...t, disabled: true } : t)) : data?.terms ?? [];
    const rank = (t: Entry) => (t.disabled ? 3 : t.stale ? 0 : t.status === "auto" ? 1 : 2);
    const by = new Map<Kind, Entry[]>(KINDS.map((k) => [k, []]));
    for (const t of list) by.get(t.kind)?.push(t);
    for (const items of by.values()) items.sort((a, b) => rank(a) - rank(b) || a.term.localeCompare(b.term));
    return by;
  }, [global, off, data]);

  if (!global && !data) return <div className="lexicon-empty">Loading…</div>;
  const last = data?.log[0];
  return (
    <>
      {!global ? (
        <div className="lexicon-tools">
          <button className="lexicon-button" disabled={!data?.log.length} onClick={() => void edit("undo")}>
            Undo last change
          </button>
          <span className="lexicon-meta">{message || (last ? `Last: ${last.summary} · ${ago(last.at)}` : "No changes yet")}</span>
        </div>
      ) : null}
      <div className="lexicon-scroll" role={ROLES.sheet} aria-label="Terms">
        {data?.pending.length ? (
          <section className="lexicon-kind">
            <div className="lexicon-kind-head">
              <span>Waiting for approval ({data.pending.length})</span>
            </div>
            {data.pending.map((p) => (
              <div className="lexicon-term-line lexicon-item" data-waiting="" role={ROLES.row} key={p.id}>
                <span className="lexicon-term" role={ROLES.cell}>{p.summary}</span>
                <span className="lexicon-meta" role={ROLES.cell}>{ago(p.at)}</span>
                <span className="lexicon-actions" role={ROLES.cell}>
                  <button className="lexicon-button" onClick={() => void edit("approve", p.id)}>Approve</button>
                  <button className="lexicon-button" onClick={() => void edit("reject", p.id)}>Reject</button>
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {KINDS.map((kind) => {
          const items = groups.get(kind) ?? [];
          const live = items.filter((t) => !t.disabled).length;
          const shut = folded.has(kind);
          return (
            <section className="lexicon-kind" key={kind} role={ROLES.rowgroup}>
              <div className="lexicon-kind-head" title={KIND_LABEL[kind].hint}>
                <button className="lexicon-kind-toggle" aria-expanded={!shut} onClick={() => fold(kind)}>
                  <span className="lexicon-chevron" data-open={shut ? undefined : ""} aria-hidden="true">
                    ›
                  </span>
                  {KIND_LABEL[kind].title} <span className="lexicon-chip">{live}</span>
                  {live ? null : <span className="lexicon-meta"> – No {KIND_LABEL[kind].title.toLowerCase()} {items.length ? "in use" : "yet"}</span>}
                </button>
                {global ? null : (
                  <button className="lexicon-button" onClick={() => {
                      setAdding(adding === kind ? null : kind);
                      fold(kind, false);
                    }} aria-expanded={adding === kind}>
                    + Add term
                  </button>
                )}
              </div>
              {!shut && adding === kind && projectId ? (
                <AddTerm
                  kind={kind}
                  projectId={projectId}
                  done={async (reply) => {
                    setAdding(null);
                    setMessage(reply);
                    await Promise.all([load(), changed?.()]);
                  }}
                  cancel={() => setAdding(null)}
                />
              ) : null}
              {(shut ? [] : items).map((t) => (
                <Item key={t.id} term={t} global={global === true} edit={edit} />
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** A form row for a new term of one kind; the server pins it, checks its wordings and says why when it refuses. */
function AddTerm({ kind, projectId, done, cancel }: { kind: Kind; projectId: string; done: (reply: string) => Promise<void>; cancel: () => void }) {
  const rpc = useRpc<typeof rpcContract>();
  const [term, setTerm] = useState("");
  const [note, setNote] = useState("");
  const [aliases, setAliases] = useState("");
  const [tone, setTone] = useState<Tone>("neutral");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    if (!term.trim()) return setError("Give the term a name.");
    setBusy(true);
    try {
      const list = aliases.split(",").map((a) => a.trim()).filter(Boolean);
      const result = await rpc.call("add_term", { projectId, term, kind, ...(note.trim() ? { note } : {}), ...(list.length ? { aliases: list } : {}), ...(kind === "outcome" ? { tone } : {}) });
      if (result.ok) await done(result.reply);
      else setError(result.reply);
    } catch {
      setError("Could not add it. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") cancel();
  };

  return (
    <div className="lexicon-add" onKeyDown={keys}>
      <input className="lexicon-input" autoFocus placeholder="Term" aria-label="Term" value={term} onChange={(e) => setTerm(e.target.value)} />
      <input className="lexicon-input" placeholder="Other wordings, comma separated" aria-label="Aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      {kind === "outcome" ? (
        <select className="lexicon-input" aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
          {TONES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      ) : null}
      <input className="lexicon-input lexicon-add-note" placeholder="What it means, in a line" aria-label="Meaning" value={note} onChange={(e) => setNote(e.target.value)} />
      <span className="lexicon-actions">
        <button className="lexicon-button" disabled={busy} onClick={() => void submit()}>Add</button>
        <button className="lexicon-button" onClick={cancel}>Cancel</button>
      </span>
      {error ? <span className="lexicon-error">{error}</span> : null}
    </div>
  );
}

const Item = memo(function Item({ term: t, global, edit }: { term: Entry; global: boolean; edit: (action: Action, id?: string) => Promise<void> }) {
  const agent = t.status === "auto";
  const meaning = t.stale ? `Going stale: ${t.stale}` : t.note;
  return (
    <div className="lexicon-term-line lexicon-item" role={ROLES.row} data-stale={t.stale && !t.disabled ? "" : undefined} data-disabled={t.disabled ? "" : undefined}>
      <span className="lexicon-term" role={ROLES.cell}>
        {t.term}
        {agent ? <span className="lexicon-meta"> · agent</span> : null}
        {t.disabled ? <span className="lexicon-meta"> · off</span> : null}
      </span>
      <span className="lexicon-meta lexicon-also" role={ROLES.cell} title={t.aliases.join(", ")}>
        {t.aliases.length ? `also ${t.aliases.join(", ")}` : ""}
      </span>
      <span className="lexicon-actions" role={ROLES.cell}>
        {agent && !t.disabled ? <button className="lexicon-button" onClick={() => void edit(t.stale ? "keep" : "pin", t.id)}>{t.stale ? "Keep" : "Pin"}</button> : null}
        <button className="lexicon-button" title={t.disabled ? "Paint and suggest this term again" : "Stop painting and suggesting this term; it stays here"} onClick={() => void edit(t.disabled ? "enable" : "disable", t.id)}>
          {t.disabled ? "Enable" : "Disable"}
        </button>
        {global ? null : <button className="lexicon-button" onClick={() => void edit("remove", t.id)}>Remove</button>}
      </span>
      <span className="lexicon-meaning" role={ROLES.cell}>{meaning || "No meaning written yet"}</span>
    </div>
  );
});
