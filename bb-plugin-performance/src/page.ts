// bb-plugin-performance — page facts shared by the collector and the dashboard.

/**
 * Whether the tab is in the background. The property name is built in two
 * pieces because `bb plugin build` reads the bare word as a utility class and
 * emits a page-wide rule for it (see AGENTS.md).
 */
export const isAway = (): boolean => Boolean(Reflect.get(document, "hid" + "den"));
