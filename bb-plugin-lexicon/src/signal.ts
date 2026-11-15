/** The realtime channel on which the backend tells every page that a lexicon moved. */
export const CHANGED = "changed";

/** What the signal carries: the project whose terms or learned names changed, or null when every project is affected (a built-in switched). */
export interface Changed {
  projectId: string | null;
}

/** Reads a payload from the channel; anything else is ignored. */
export function readChanged(payload: unknown): Changed | null {
  if (typeof payload !== "object" || payload === null) return null;
  const projectId = (payload as { projectId?: unknown }).projectId;
  return projectId === null || typeof projectId === "string" ? { projectId } : null;
}

/** Whether a signal concerns a project (the one a thread's environment belongs to). */
export const concerns = (signal: Changed, projectId: string | null): boolean => signal.projectId === null || signal.projectId === projectId;
