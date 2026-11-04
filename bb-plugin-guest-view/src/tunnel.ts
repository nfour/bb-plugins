// Runs a Cloudflare quick tunnel (`cloudflared tunnel --url http://127.0.0.1:<port>`)
// and reads its random *.trycloudflare.com address from the log. Nothing is ever
// installed: when cloudflared is missing, `findCloudflared` says so and the owner
// gets the install steps (`installSteps`).
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, constants, readFile } from "node:fs/promises";
import { homedir, platform, arch } from "node:os";
import { delimiter, join } from "node:path";
import { CLOUDFLARED_VERSION, manualCommand } from "./install.ts";
import { redactTunnelLine } from "./model.ts";

const URL_PATTERN = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const START_TIMEOUT_MS = 45_000;

async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The cloudflared binary: the configured path, else PATH and the usual install places. */
export async function findCloudflared(configured: string): Promise<string | null> {
  if (configured.trim()) return (await executable(configured.trim())) ? configured.trim() : null;
  const name = platform() === "win32" ? "cloudflared.exe" : "cloudflared";
  const dirs = [...(process.env.PATH ?? "").split(delimiter), join(homedir(), ".local", "bin"), join(homedir(), "bin"), "/usr/local/bin", "/usr/bin", "/opt/homebrew/bin"];
  for (const dir of dirs) {
    if (dir && (await executable(join(dir, name)))) return join(dir, name);
  }
  return null;
}

/** How to install cloudflared on this machine, as text and a command to copy. */
export function installSteps(): { text: string; command: string; url: string } {
  const url = "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
  if (platform() === "darwin") return { text: "Install it with Homebrew, then try again.", command: "brew install cloudflared", url };
  if (platform() === "win32") return { text: "Install it with winget, then try again.", command: "winget install --id Cloudflare.cloudflared", url };
  return {
    text: `Download Cloudflare's cloudflared ${CLOUDFLARED_VERSION} into ~/.local/bin (no root needed; the command checks its SHA-256), then try again.`,
    command: manualCommand(arch()),
    url,
  };
}

export interface Tunnel {
  url: string;
  /** The cloudflared process id, to find it again if this process dies without stopping it. */
  pid: number | undefined;
  /** Asks cloudflared to stop and, if it has not within a few seconds, kills it. Resolves once it has exited. */
  stop(): Promise<void>;
  /** Resolves when the process exits, for whatever reason. */
  exited: Promise<void>;
}

/** How long cloudflared gets to stop on its own before it is killed. */
const STOP_GRACE_MS = 3_000;

/** Whether a command line is a quick tunnel of this plugin (`cloudflared tunnel … --url http://127.0.0.1:<port>`). */
export function isOurTunnel(commandLine: string): boolean {
  return /cloudflared/i.test(commandLine) && /\btunnel\b/.test(commandLine) && /--url[ =]http:\/\/127\.0\.0\.1:\d+/.test(commandLine);
}

async function commandLineOf(pid: number): Promise<string | null> {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8")).replace(/\0/g, " ").trim();
  } catch {
    // No /proc (macOS) or no such process: try ps, which fails for a process that is gone.
  }
  return new Promise((resolve) => {
    execFile("ps", ["-p", String(pid), "-o", "command="], { timeout: 3_000 }, (error, stdout) => resolve(error ? null : stdout.trim() || null));
  });
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A cloudflared this plugin started in an earlier run and never stopped (BB's server was killed)
 * still holds its public address. Stops it when the process with that id is really one of ours;
 * an id that now belongs to anything else is left alone. Says whether a tunnel was stopped.
 */
export async function stopLeftoverTunnel(pid: unknown, graceMs = STOP_GRACE_MS): Promise<boolean> {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return false;
  const command = await commandLineOf(pid);
  if (!command || !isOurTunnel(command)) return false;
  process.kill(pid, "SIGTERM");
  const until = Date.now() + graceMs;
  while (alive(pid) && Date.now() < until) await new Promise((done) => setTimeout(done, 100));
  if (alive(pid)) process.kill(pid, "SIGKILL");
  return true;
}

/**
 * Starts a quick tunnel to the local port and resolves with its public address
 * once cloudflared has registered a connection (or printed the address and gone
 * quiet for a few seconds).
 */
export function startTunnel(binary: string, port: number, log: (line: string) => void, graceMs = STOP_GRACE_MS): Promise<Tunnel> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      // A quick tunnel only: no account, no update checks.
      child = spawn(binary, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let url: string | null = null;
    let settled = false;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const exited = new Promise<void>((done) => child.once("exit", () => done()));
    const isUp = () => child.exitCode === null && child.signalCode === null;
    const stop = async () => {
      if (!isUp()) return;
      child.kill("SIGTERM");
      const forced = setTimeout(() => {
        if (isUp()) child.kill("SIGKILL");
      }, graceMs);
      await exited;
      clearTimeout(forced);
    };
    const finish = () => {
      if (settled || !url) return;
      settled = true;
      clearTimeout(timer);
      if (quiet) clearTimeout(quiet);
      resolve({ url, pid: child.pid, stop, exited });
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stop();
      reject(new Error("cloudflared did not open a tunnel within 45 seconds."));
    }, START_TIMEOUT_MS);
    let tail = "";
    const read = (chunk: Buffer) => {
      tail += chunk.toString("utf8");
      const lines = tail.split("\n");
      tail = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        // The log must never hold a working guest link: its request lines carry the token.
        log(redactTunnelLine(line.trim()).slice(0, 300));
        const match = URL_PATTERN.exec(line);
        if (match && !url) {
          url = match[0];
          quiet = setTimeout(finish, 8000);
        }
        if (url && /Registered tunnel connection/i.test(line)) finish();
      }
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited (code ${code ?? "none"}) before the tunnel opened.`));
    });
  });
}
