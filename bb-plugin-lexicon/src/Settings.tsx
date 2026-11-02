import { useCallback, useEffect, useState } from "react";
import { useBbContext, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { useOptions } from "./options";
import type { Entry } from "./lexicon";

interface Project {
  id: string;
  name: string;
}
type Data = { terms: Entry[]; pending: { id: string; at: number; thread?: string; summary: string }[]; log: { at: number; by: string; summary: string }[] };

const when = (at: number) => new Date(at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

/**
 * The lexicon's page in the plugin's settings: pick a project, see what agents
 * added and what waits for approval, keep (pin) or remove terms, step back.
 */
export function Settings() {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const options = useOptions();
  const { projectId: current } = useBbContext();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(current);
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let stale = false;
    sdk.projects.list().then((list) => !stale && setProjects(list.map((p) => ({ id: p.id, name: p.name })))).catch(() => {});
    return () => void (stale = true);
  }, [sdk]);

  const load = useCallback(async () => {
    if (!projectId) return setData(null);
    try {
      setData((await rpc.call("review", { projectId })) as Data);
    } catch {
      setData(null);
    }
  }, [rpc, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

  const edit = async (action: "pin" | "keep" | "remove" | "approve" | "reject" | "undo", id?: string) => {
    if (!projectId) return;
    const result = await rpc.call("edit", id === undefined ? { projectId, action } : { projectId, action, id });
    setMessage(result.reply);
    await load();
  };
  const toggle = (key: "agents" | "proposals") => void rpc.call("set_setting", { key, value: !options[key] }).catch(() => {});

  const auto = data?.terms.filter((t) => t.status === "auto") ?? [];
  const mine = data?.terms.filter((t) => t.status !== "auto") ?? [];

  return (
    <div className="lexicon-page">
      <div className="lexicon-bar">
        <select className="lexicon-select" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)}>
          <option value="">Choose a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button className="lexicon-button" onClick={() => toggle("agents")}>
          {options.agents ? "Agents maintain it: on" : "Agents maintain it: off"}
        </button>
        <button className="lexicon-button" disabled={!options.agents} onClick={() => toggle("proposals")}>
          {options.proposals ? "Agents propose: on" : "Agents propose: off"}
        </button>
        <button className="lexicon-button" disabled={!data?.log.length} onClick={() => void edit("undo")}>
          Undo last change
        </button>
      </div>
      {message ? <div className="lexicon-note">{message}</div> : null}
      {!projectId ? <div className="lexicon-empty">Choose a project to review its terms.</div> : null}
      {data ? (
        <>
          <h3 className="lexicon-h">Waiting for approval ({data.pending.length})</h3>
          {data.pending.length ? (
            <ul className="lexicon-list">
              {data.pending.map((p) => (
                <li className="lexicon-row" key={p.id}>
                  <div className="lexicon-main">
                    <span className="lexicon-term">{p.summary}</span>
                    <span className="lexicon-meta">{when(p.at)}</span>
                  </div>
                  <div className="lexicon-actions">
                    <button className="lexicon-button" onClick={() => void edit("approve", p.id)}>Approve</button>
                    <button className="lexicon-button" onClick={() => void edit("reject", p.id)}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="lexicon-empty">Nothing is waiting.</div>
          )}
          <h3 className="lexicon-h">Added by agents ({auto.length})</h3>
          {auto.length ? (
            <ul className="lexicon-list">
              {auto.map((t) => (
                <li className="lexicon-row" key={t.id} data-stale={t.stale ? "" : undefined}>
                  <div className="lexicon-main">
                    <span className="lexicon-term">{t.term}</span>
                    <span className="lexicon-meta">
                      {t.kind}
                      {t.note ? ` · ${t.note}` : ""}
                      {t.aliases.length ? ` · also ${t.aliases.join(", ")}` : ""}
                      {t.stale ? ` · going stale: ${t.stale}` : ""}
                      {t.added ? ` · ${when(t.added)}` : ""}
                    </span>
                  </div>
                  <div className="lexicon-actions">
                    <button className="lexicon-button" onClick={() => void edit(t.stale ? "keep" : "pin", t.id)}>{t.stale ? "Keep" : "Pin"}</button>
                    <button className="lexicon-button" onClick={() => void edit("remove", t.id)}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="lexicon-empty">No agent terms yet.</div>
          )}
          <h3 className="lexicon-h">Yours ({mine.length})</h3>
          <ul className="lexicon-list">
            {mine.map((t) => (
              <li className="lexicon-row" key={t.id}>
                <div className="lexicon-main">
                  <span className="lexicon-term">{t.term}</span>
                  <span className="lexicon-meta">{t.kind}{t.aliases.length ? ` · also ${t.aliases.join(", ")}` : ""}</span>
                </div>
                <div className="lexicon-actions">
                  <button className="lexicon-button" onClick={() => void edit("remove", t.id)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
          <h3 className="lexicon-h">Recent changes</h3>
          <ul className="lexicon-list">
            {data.log.map((c, i) => (
              <li className="lexicon-meta" key={i}>
                {when(c.at)} · {c.by} · {c.summary}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
