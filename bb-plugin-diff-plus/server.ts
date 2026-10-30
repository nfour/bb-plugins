// bb-plugin-diff-plus — backend entry.
//
// Reads the changed files for the tree from BB's Git plugin (`bb--git`), and
// which of them are marked Viewed. The calls are made here rather than in the
// page because they need a zod schema for the answer, and zod is not shared
// with the page: it would be bundled into app.js.
//
// It also backs "recent commits" in the scope picker. BB's Diff tab lists only
// the commits since the environment's merge base, and drops a picked commit that
// is not among them, so on a branch compared with itself there are none. The
// page lists the last N commits itself; picking one moves the merge base to the
// commit N back (a sha passes bb--git's branch-name check) so BB lists and shows
// it, and picking any other scope puts the base back. The base it replaced is
// kept in kv until then.
//
// Everything else is in the page (app.tsx).
import { execFile } from "node:child_process";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const target = z.discriminatedUnion("type", [
  z.object({ type: z.literal("uncommitted") }),
  z.object({ type: z.literal("all"), mergeBaseBranch: z.string().min(1) }),
  z.object({ type: z.literal("branch_committed"), mergeBaseBranch: z.string().min(1) }),
  z.object({ type: z.literal("commit"), sha: z.string().min(1) }),
]);

/** The part of `bb--git`'s `files` answer the tree reads; zod drops the rest. */
const files = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"),
    truncated: z.boolean(),
    files: z.array(
      z.object({
        path: z.string(),
        previousPath: z.string().nullable(),
        changeKind: z.enum(["added", "modified", "deleted", "renamed", "copied", "type_changed"]),
        additions: z.number(),
        deletions: z.number(),
        origin: z.enum(["tracked", "untracked"]),
        /** What "Viewed" is recorded against: a file stays viewed while this is unchanged. */
        revision: z.string(),
      }),
    ),
  }),
  z.object({ outcome: z.literal("not_applicable"), message: z.string() }),
  z.object({ outcome: z.literal("unavailable"), failure: z.object({ message: z.string() }) }),
]);

/** `bb--git`'s `viewed` answer: the files marked Viewed, at the revision they were marked at. */
const viewed = z.object({ files: z.array(z.object({ path: z.string(), revision: z.string() })) });

const commits = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), commits: z.array(z.object({ sha: z.string(), shortSha: z.string(), subject: z.string() })) }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

const moved = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), moved: z.boolean() }),
  z.object({ ok: z.literal(false), message: z.string() }),
]);

export const rpcContract = defineRpcContract({
  files: { input: z.object({ environmentId: z.string().min(1), target }), output: files },
  /** The files marked Viewed in the Diff tab, for its "Viewed files" filter. */
  viewed: { input: z.object({ environmentId: z.string().min(1), target }), output: viewed },
  /** The newest `count` commits of HEAD that have a parent, newest first (the root commit is left out). */
  recent_commits: { input: z.object({ environmentId: z.string().min(1), count: z.number().int().min(1).max(50) }), output: commits },
  /** Moves the merge base back `count` commits so BB lists them; `moved` true while a record stands for it. */
  show_recent: { input: z.object({ environmentId: z.string().min(1), count: z.number().int().min(1).max(50) }), output: moved },
  /** Puts back the merge base `show_recent` replaced; `moved` false when there was nothing to put back. */
  restore_base: {
    input: z.object({
      environmentId: z.string().min(1),
      /** Why, for the log. */
      reason: z.enum(["scope", "abandoned", "recent-off", "dispose", "startup"]).default("scope"),
    }),
    output: moved,
  },
});

/** What recent commits replaced, per environment. */
interface Recent {
  /** The merge base before (null: the environment's default). */
  previous: string | null;
  /** The commit it was moved to. */
  sha: string;
}
const recentKey = (environmentId: string) => `recent:${environmentId}`;

/** `git log` in `path`: the newest `count` commits of HEAD, newest first. */
const log = (path: string, count: number) =>
  new Promise<{ sha: string; shortSha: string; subject: string }[]>((resolve, reject) =>
    execFile("git", ["-C", path, "log", `--max-count=${count}`, "--format=%H%x00%h%x00%s", "HEAD"], { timeout: 5000 }, (error, stdout) =>
      error
        ? reject(error)
        : resolve(
            stdout
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                const [sha = "", shortSha = "", subject = ""] = line.split("\0");
                return { sha, shortSha, subject };
              }),
          ),
    ),
  );

const setMergeBaseResult = z.object({ ok: z.boolean() });

export default async function plugin(bb: BbPluginApi) {
  const { kv } = bb.storage;
  const setMergeBase = async (environmentId: string, mergeBaseBranch: string | null) => {
    const result = await bb.sdk.plugins.callRpc({
      pluginId: "bb--git",
      method: "setMergeBase",
      input: { environmentId, mergeBaseBranch },
      outputSchema: setMergeBaseResult,
    });
    if (!result.ok) throw new Error("The environment is not ready.");
  };
  // One move at a time per environment, so two calls never interleave their
  // read-modify-write of the base and its record.
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(environmentId: string, task: () => Promise<T>): Promise<T> => {
    const run = (chains.get(environmentId) ?? Promise.resolve()).then(task, task);
    const tail = run.catch(() => {});
    chains.set(environmentId, tail);
    void tail.then(() => chains.get(environmentId) === tail && chains.delete(environmentId));
    return run;
  };
  /** The stored record while the base is still the one it set; a base changed elsewhere drops it. */
  const current = async (environmentId: string) => {
    const record = await kv.get<Recent>(recentKey(environmentId));
    if (!record) return null;
    const environment = await bb.sdk.environments.get({ environmentId });
    if (environment.mergeBaseBranch === record.sha) return record;
    bb.log.info(`base record dropped ${environmentId}: base is ${environment.mergeBaseBranch ?? "default"}, not ${record.sha} (changed elsewhere)`);
    await kv.delete(recentKey(environmentId));
    return null;
  };
  /** Puts the replaced base back (inside `serial`); true when there was one to put back. */
  const restore = async (environmentId: string, reason: string) => {
    const record = await current(environmentId);
    if (!record) return false;
    await setMergeBase(environmentId, record.previous);
    await kv.delete(recentKey(environmentId));
    bb.log.info(`base restored ${environmentId}: ${record.sha} -> ${record.previous ?? "default"} (${reason})`);
    return true;
  };
  const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));
  const pathOf = async (environmentId: string) => {
    const environment = await bb.sdk.environments.get({ environmentId });
    if (!environment.path) throw new Error("This environment has no folder.");
    return { environment, path: environment.path };
  };

  bb.rpc.register(rpcContract, {
    files: (input) =>
      bb.sdk.plugins.callRpc({
        pluginId: "bb--git",
        method: "files",
        input: { ...input, ignoreWhitespace: false },
        outputSchema: files,
      }),
    viewed: (input) => bb.sdk.plugins.callRpc({ pluginId: "bb--git", method: "viewed", input, outputSchema: viewed }),
    recent_commits: async ({ environmentId, count }) => {
      try {
        const { path } = await pathOf(environmentId);
        // One more than asked for: a history that ends inside the count has its
        // root commit last, which has no parent for the base to be set to.
        const commits = await log(path, count + 1);
        return { ok: true as const, commits: commits.length > count ? commits.slice(0, count) : commits.slice(0, -1) };
      } catch (cause) {
        return { ok: false as const, message: message(cause) };
      }
    },
    show_recent: ({ environmentId, count }) =>
      serial(environmentId, async () => {
        try {
          const record = await current(environmentId);
          const { environment, path } = await pathOf(environmentId);
          // One more than asked for: the base itself is not listed. A shorter
          // history bases on its first commit, which then is not listed either.
          const commits = await log(path, count + 1);
          const sha = (commits[count] ?? commits.at(-1))?.sha;
          if (!sha) return { ok: false as const, message: "This branch has no commits." };
          if (environment.mergeBaseBranch === sha) return { ok: true as const, moved: Boolean(record) };
          const previous = record ? record.previous : (environment.mergeBaseBranch ?? null);
          // The record first: a base moved without one could not be put back.
          await kv.set(recentKey(environmentId), { previous, sha } satisfies Recent);
          try {
            await setMergeBase(environmentId, sha);
          } catch (cause) {
            await (record ? kv.set(recentKey(environmentId), record) : kv.delete(recentKey(environmentId)));
            throw cause;
          }
          bb.log.info(`base moved ${environmentId}: ${environment.mergeBaseBranch ?? "default"} -> ${sha} (last ${count})`);
          return { ok: true as const, moved: true };
        } catch (cause) {
          bb.log.warn(`showing recent commits failed for ${environmentId}: ${message(cause)}`);
          return { ok: false as const, message: message(cause) };
        }
      }),
    restore_base: ({ environmentId, reason }) =>
      serial(environmentId, async () => {
        try {
          return { ok: true as const, moved: await restore(environmentId, reason) };
        } catch (cause) {
          bb.log.warn(`restoring the merge base failed for ${environmentId}: ${message(cause)}`);
          return { ok: false as const, message: message(cause) };
        }
      }),
  });
  // A page that closed or a disabled plugin must not leave the checkout
  // comparing with an old commit: put every base back on the way out, and on the
  // way in for what an earlier run left.
  const restoreAll = async (reason: "dispose" | "startup") => {
    try {
      const prefix = recentKey("");
      for (const key of await kv.list(prefix)) {
        const environmentId = key.slice(prefix.length);
        await serial(environmentId, () => restore(environmentId, reason)).catch((cause) =>
          bb.log.warn(`restoring the merge base failed for ${environmentId}: ${message(cause)}`),
        );
      }
    } catch (cause) {
      bb.log.warn(`restoring the merge bases (${reason}) failed: ${message(cause)}`);
    }
  };
  bb.log.info("loaded");
  void restoreAll("startup");
  bb.onDispose(async () => {
    await restoreAll("dispose");
    bb.log.info("disposed");
  });
}
