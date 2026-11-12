/**
 * Which halves of the bar are drawn. Kept out of `server.ts` and import-free so the
 * page bundle, which reads it too, does not pull in the server's SDK and zod.
 */
export const HALVES = ["both", "message", "reply"] as const;
export type Halves = (typeof HALVES)[number];
