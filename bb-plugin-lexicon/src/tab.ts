/** Whether the browser tab is in the background. Built from two strings because the plugin build reads the bare property name as a utility class. */
const SHOWN = "vis" + "ible";
export const tabAway = (): boolean => document.visibilityState !== SHOWN;
