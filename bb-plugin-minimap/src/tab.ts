/** Whether the tab is in the background. The property's name is spelled from parts: the bare word would become a page-wide rule in the build. */
export const inBackground = (): boolean => Boolean((document as unknown as Record<string, unknown>)[["hid", "den"].join("")]);
