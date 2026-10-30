// "Recent commits" in BB's scope picker: the newest commits of HEAD, read in the
// backend with git (see server.ts), and re-read when the branch moves.
import { useEffect, useState } from "react";
import { useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../server";

/** Changes that can mean new commits. */
const FOLLOW_ON = new Set(["git-refs-changed", "metadata-changed"]);
const FOLLOW_WAIT_MS = 1000;

export interface RecentCommit {
  sha: string;
  shortSha: string;
  subject: string;
}

/** The newest `count` commits, newest first; empty while off, loading or failed. */
export function useRecentCommits(environmentId: string | null, count: number, enabled: boolean): readonly RecentCommit[] {
  const sdk = useSdk();
  const rpc = useRpc<typeof rpcContract>();
  const [commits, setCommits] = useState<readonly RecentCommit[]>([]);
  // Cleared only when the environment changes or the list is switched off, not
  // on a new count or a re-read, so the menu does not flash empty.
  useEffect(() => {
    setCommits([]);
  }, [environmentId, enabled]);
  useEffect(() => {
    if (!environmentId || !enabled) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = () =>
      rpc
        .call("recent_commits", { environmentId, count })
        .then((result) => !disposed && result.ok && setCommits(result.commits))
        .catch(() => {});
    void read();
    const unsubscribe = sdk.subscribe({
      event: "environment:changed",
      environmentId,
      callback: ({ changes }) => {
        if (!changes.some((change) => FOLLOW_ON.has(change))) return;
        clearTimeout(timer);
        timer = setTimeout(read, FOLLOW_WAIT_MS);
      },
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }, [sdk, rpc, environmentId, count, enabled]);
  return commits;
}
