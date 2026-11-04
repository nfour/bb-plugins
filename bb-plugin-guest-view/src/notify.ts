// Guest prompts reach the owner's phone as push notifications, but a flood of prompts
// (rate limits allow dozens a minute) must not become a flood of notifications: the first
// one goes at once, the ones that follow within the window are told as a single summary.
// Pure apart from the timer it is given; checked in src/notify.test.ts.

export interface Notice {
  title: string;
  body: string;
}

export interface Told {
  name: string;
  text: string;
}

/** What to tell about one or more prompts. */
export function describePrompts(prompts: readonly Told[]): Notice {
  if (prompts.length === 1) {
    const { name, text } = prompts[0]!;
    return { title: `${name} suggested a prompt`, body: text.length > 140 ? `${text.slice(0, 139)}…` : text };
  }
  const names = [...new Set(prompts.map((p) => p.name))];
  const shown = names.slice(0, 3).join(", ");
  const rest = names.length > 3 ? ` and ${names.length - 3} more` : "";
  return { title: `${prompts.length} new guest prompts`, body: `From ${shown}${rest}` };
}

export class NoticeBatch {
  private waiting: Told[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastSent = Number.NEGATIVE_INFINITY;
  private readonly send: (notice: Notice) => void;
  private readonly windowMs: number;

  constructor(send: (notice: Notice) => void, windowMs = 30_000) {
    this.send = send;
    this.windowMs = windowMs;
  }

  /** A prompt arrived: tell it now, or fold it into the summary that goes when the window ends. */
  add(prompt: Told): void {
    this.waiting.push(prompt);
    if (this.timer) return;
    const wait = this.lastSent + this.windowMs - Date.now();
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  /** Drops what is waiting (the share ended). */
  cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = [];
  }

  private flush(): void {
    this.timer = null;
    if (this.waiting.length === 0) return;
    const notice = describePrompts(this.waiting);
    this.waiting = [];
    this.lastSent = Date.now();
    this.send(notice);
  }
}
