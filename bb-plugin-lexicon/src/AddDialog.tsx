import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";
import { closeAdd, useAddRequest, type AddRequest } from "./addState";
import { KINDS, type Kind } from "./lexicon";

const KIND_NAME: Record<Kind, string> = { name: "Name", feature: "Feature", option: "Option", code: "Code", action: "Action", outcome: "Outcome", topic: "Topic" };

/** What a selection most likely is: a lone identifier is code, anything else a feature. */
const guessKind = (text: string): Kind => (!/\s/.test(text) && (/[-_.]/.test(text) || /\p{Ll}\p{Lu}/u.test(text)) ? "code" : "feature");

/** Renders nothing until the message action asks for it. */
export function AddDialog() {
  const request = useAddRequest();
  return request ? <Dialog key={request.at} request={request} /> : null;
}

type Known = { projectId: string | null; terms: { id: string; term: string; kind: Kind }[] };

/** "Add to lexicon": the selected words as a new term, or as another wording of a term the project has. */
function Dialog({ request }: { request: AddRequest }) {
  const rpc = useRpc<typeof rpcContract>();
  const text = request.text.trim().slice(0, 80);
  const [known, setKnown] = useState<Known | null>(null);
  const [mode, setMode] = useState<"new" | "alias">("new");
  const [term, setTerm] = useState(text);
  const [kind, setKind] = useState<Kind>(guessKind(text));
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    rpc.call("context", { threadId: request.threadId }).then((found) => !stale && setKnown(found)).catch(() => !stale && setError("Could not read this project's terms."));
    return () => void (stale = true);
  }, [rpc, request.threadId]);
  useEffect(() => {
    const keys = (e: KeyboardEvent) => e.key === "Escape" && closeAdd();
    document.addEventListener("keydown", keys);
    return () => document.removeEventListener("keydown", keys);
  }, []);

  const submit = async () => {
    if (busy) return;
    if (!known?.projectId) return setError("This thread has no project to add to.");
    if (!term.trim()) return setError("Give it a wording.");
    if (mode === "alias" && !target) return setError("Pick the term it is another wording of.");
    setBusy(true);
    try {
      const result =
        mode === "alias"
          ? await rpc.call("add_alias", { projectId: known.projectId, id: target, alias: term })
          : await rpc.call("add_term", { projectId: known.projectId, term, kind, ...(note.trim() ? { note } : {}) });
      if (result.ok) closeAdd();
      else setError(result.reply);
    } catch {
      setError("Could not add it. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const enter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !(e.target instanceof HTMLSelectElement)) void submit();
  };

  return (
    <div className="lexicon-dialog" role="dialog" aria-label="Add to lexicon" onKeyDown={enter}>
      <div className="lexicon-dialog-title">Add to lexicon</div>
      <div className="lexicon-kind-chips">
        <button className="lexicon-kind-chip" aria-pressed={mode === "new"} onClick={() => setMode("new")}>New term</button>
        <button className="lexicon-kind-chip" aria-pressed={mode === "alias"} onClick={() => setMode("alias")}>Another wording of a term</button>
      </div>
      <input className="lexicon-input" autoFocus aria-label="Wording" placeholder="Wording" value={term} onChange={(e) => setTerm(e.target.value)} />
      {mode === "new" ? (
        <>
          <select className="lexicon-input" aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>{KIND_NAME[k]}</option>
            ))}
          </select>
          <input className="lexicon-input" aria-label="Meaning" placeholder="What it means, in a line (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        </>
      ) : (
        <select className="lexicon-input" aria-label="Term" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">{known ? (known.terms.length ? "Pick a term" : "No terms yet") : "Loading…"}</option>
          {KINDS.map((k) => {
            const terms = (known?.terms ?? []).filter((t) => t.kind === k);
            return terms.length ? (
              <optgroup key={k} label={KIND_NAME[k]}>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.term}</option>
                ))}
              </optgroup>
            ) : null;
          })}
        </select>
      )}
      {error ? <span className="lexicon-error">{error}</span> : null}
      <span className="lexicon-actions">
        <button className="lexicon-button" disabled={busy} onClick={() => void submit()}>Add</button>
        <button className="lexicon-button" onClick={closeAdd}>Cancel</button>
      </span>
    </div>
  );
}
