let query: MediaQueryList | null = null;

/** Whether the reader asked for less motion. One query for the whole page; it keeps its own answer current. */
export function reducedMotion(): boolean {
  query ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return query.matches;
}
