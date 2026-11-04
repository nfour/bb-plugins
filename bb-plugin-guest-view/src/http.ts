// The guest server: a plain Node HTTP server on 127.0.0.1 and a random port, which
// the Cloudflare tunnel points at. It has three routes and nothing else:
//
//   GET  /<token>          the guest page
//   GET  /<token>/poll     the live transcript (long polling: what changed since a revision)
//   POST /<token>/prompts  a guest's prompt, held for the owner's approval
//
// Every other path, method or token gets the same 404, so a wrong token and an
// ended share look alike. BB's own API is never reachable through it.
import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { TOKEN_PATTERN } from "./model.ts";
import { guestPage, NOT_FOUND_PAGE } from "./page.ts";

const MAX_BODY_BYTES = 16 * 1024;
/** A poll waits this long for a change before answering "nothing new". */
const POLL_WAIT_MS = 25_000;

export interface GuestRoutes {
  /** The live share a token opens, or null. Compares tokens in constant time. */
  find(token: string): { id: string; suggestedName: string; maxChars: number } | null;
  /** Answers when something after `since` exists, or after `waitMs` with nothing new. */
  poll(shareId: string, since: number, client: string, name: string, ip: string, waitMs: number, closed: AbortSignal): Promise<{ status: number; body: unknown }>;
  submit(shareId: string, body: unknown, ip: string): Promise<{ status: number; body: Record<string, unknown> }>;
}

const BASE_HEADERS: Record<string, string> = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
};

function send(res: ServerResponse, status: number, type: string, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, { ...BASE_HEADERS, "content-type": type, "content-length": Buffer.byteLength(body), ...extra });
  res.end(body);
}

function notFound(res: ServerResponse) {
  send(res, 404, "text/html; charset=utf-8", NOT_FOUND_PAGE, { "content-security-policy": "default-src 'none'" });
}

function json(res: ServerResponse, status: number, body: Record<string, unknown>) {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(body), { "content-security-policy": "default-src 'none'" });
}

/**
 * The visitor's address as Cloudflare reports it, else the socket's (a local caller). The header is trusted
 * because only cloudflared reaches this port and Cloudflare sets it itself. A local process that learned the
 * port could forge it to dodge the per-address limits, but it would still need the token to get anywhere.
 */
function clientIp(req: IncomingMessage): string {
  const header = req.headers["cf-connecting-ip"];
  const value = Array.isArray(header) ? header[0] : header;
  return (value && value.length <= 64 ? value : req.socket.remoteAddress) ?? "unknown";
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let size = 0;
    const chunks: Buffer[] = [];
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // Stop reading; the 413 goes out with "connection: close" and the socket is dropped after it.
        req.pause();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => finish(null));
  });
}

async function handle(routes: GuestRoutes, req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://guest.invalid");
  const parts = url.pathname.split("/").filter(Boolean);
  const token = parts[0] ?? "";
  const route = parts.slice(1).join("/");
  if (parts.length > 2 || !TOKEN_PATTERN.test(token) || !["", "poll", "prompts"].includes(route)) return notFound(res);
  const share = routes.find(token);
  if (!share) return notFound(res);

  if (route === "" && (req.method === "GET" || req.method === "HEAD")) {
    const nonce = randomBytes(18).toString("base64");
    const page = guestPage({ token, shareId: share.id, suggestedName: share.suggestedName, nonce, maxChars: share.maxChars });
    return send(res, 200, "text/html; charset=utf-8", req.method === "HEAD" ? "" : page, {
      "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
  }

  if (route === "poll" && req.method === "GET") {
    const since = Number(url.searchParams.get("since") ?? "0");
    const client = url.searchParams.get("client") ?? "";
    if (!Number.isSafeInteger(since) || !/^[0-9a-f]{24}$/.test(client)) return json(res, 400, { error: "Bad request." });
    const closed = new AbortController();
    res.on("close", () => closed.abort());
    const result = await routes.poll(share.id, since, client, url.searchParams.get("name") ?? "", clientIp(req), POLL_WAIT_MS, closed.signal);
    if (closed.signal.aborted) return;
    return json(res, result.status, result.body as Record<string, unknown>);
  }

  if (route === "prompts" && req.method === "POST") {
    if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) return json(res, 415, { error: "Send JSON." });
    const raw = await readBody(req);
    if (raw === null) {
      res.on("finish", () => req.destroy());
      return send(res, 413, "application/json; charset=utf-8", JSON.stringify({ error: "The prompt is too long." }), { connection: "close", "content-security-policy": "default-src 'none'" });
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { error: "Send JSON." });
    }
    const result = await routes.submit(share.id, body, clientIp(req));
    return json(res, result.status, result.body);
  }

  return notFound(res);
}

export interface GuestServer {
  port: number;
  close(): Promise<void>;
}

/** Starts the server on 127.0.0.1 with a random free port. */
export function startGuestServer(routes: GuestRoutes, onError: (error: unknown) => void): Promise<GuestServer> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      handle(routes, req, res).catch((error) => {
        onError(error);
        if (!res.headersSent) json(res, 500, { error: "Something went wrong." });
        else res.end();
      });
    });
    server.headersTimeout = 15_000;
    server.requestTimeout = 30_000;
    server.keepAliveTimeout = 5_000;
    server.maxHeadersCount = 60;
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("The guest server has no port."));
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}
