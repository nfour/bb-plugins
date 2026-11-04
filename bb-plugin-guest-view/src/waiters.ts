// The long polls waiting for a change on one share. A Cloudflare quick tunnel carries at
// most 200 requests at once (more are refused with a 429 for everyone), so one visitor
// must not be able to park a poll per request: each page client id, each address and the
// share as a whole may hold only so many. Pure; checked in src/waiters.test.ts.

export interface WaitLimits {
  /** Polls one page (client id) may have waiting; a newer one releases the oldest. */
  perClient: number;
  /** Polls one address may have waiting across all its pages; a newer one releases the oldest. */
  perIp: number;
  /** Polls the share may have waiting; beyond it a new poll is refused, so a flood cannot push out the people already there. */
  total: number;
}

/** Why a wait ended. */
export type WaitEnd = "woken" | "timeout" | "closed" | "released" | "full";

interface Waiting {
  client: string;
  ip: string;
  end(reason: WaitEnd): void;
}

export class WaitSet {
  private readonly waiting: Waiting[] = [];
  private readonly limits: WaitLimits;

  constructor(limits: WaitLimits) {
    this.limits = limits;
  }

  get size(): number {
    return this.waiting.length;
  }

  /**
   * Waits until `wakeAll` is called, `ms` pass or `closed` aborts. Resolves "full" at once when the
   * share already holds `total` waiting polls. When the page or the address is at its limit, its
   * oldest waiting poll ends as "released" (it answers "nothing new" and the page asks again).
   */
  wait(client: string, ip: string, ms: number, closed: AbortSignal): Promise<WaitEnd> {
    if (closed.aborted) return Promise.resolve("closed");
    if (this.waiting.length >= this.limits.total) return Promise.resolve("full");
    this.release((w) => w.client === client, this.limits.perClient);
    this.release((w) => w.ip === ip, this.limits.perIp);
    return new Promise<WaitEnd>((resolve) => {
      let over = false;
      const end = (reason: WaitEnd) => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        closed.removeEventListener("abort", onAbort);
        const at = this.waiting.indexOf(entry);
        if (at >= 0) this.waiting.splice(at, 1);
        resolve(reason);
      };
      const onAbort = () => end("closed");
      const timer = setTimeout(() => end("timeout"), ms);
      const entry: Waiting = { client, ip, end };
      closed.addEventListener("abort", onAbort);
      this.waiting.push(entry);
    });
  }

  /** Ends every wait, as there is something new to answer with. */
  wakeAll(): void {
    for (const entry of [...this.waiting]) entry.end("woken");
  }

  /** Ends the oldest matching waits until fewer than `keep` of them remain. */
  private release(matches: (w: Waiting) => boolean, keep: number): void {
    for (;;) {
      const same = this.waiting.filter(matches);
      if (same.length < keep) return;
      same[0]!.end("released");
    }
  }
}
