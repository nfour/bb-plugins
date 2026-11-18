// How a moved merge base is kept honest without page teardown (bb 0.50 skips it on unload). No imports:
// the page and server.ts both read it, and the page may take only types from server.ts.

/** While a base is moved, the page that moved it says so this often (server.ts `keep_base`). */
export const BEAT_MS = 20_000;
/** A moved base whose page has been quiet this long is put back: three beats, and room for a background tab's held timers. */
export const LEASE_MS = 150_000;
/** How often the server looks for lapsed leases. */
export const SWEEP_MS = 15_000;
/** A lapsed lease whose restore keeps failing is tried this many times, further apart each time, then left to the startup restore. */
export const MAX_LAPSE_TRIES = 4;
