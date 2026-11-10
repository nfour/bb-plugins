/**
 * Values a control in the settings panel shows while it is being dragged, before they are saved. The strip,
 * the panel and the menu read these over the saved settings, so the change follows the pointer at frame
 * rate, and a setting is written once when the control is released, not on every step of the drag.
 */
export type Preview = Readonly<Record<string, number | string>>;

let current: Preview = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Shows `value` for `key` until it is cleared. */
export function setPreview(key: string, value: number | string): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  emit();
}

/** Stops showing a value for `key`, and what is saved shows again. */
export function clearPreview(key: string): void {
  if (!(key in current)) return;
  const { [key]: _gone, ...rest } = current;
  current = rest;
  emit();
}

export const getPreview = (key: string): number | string | undefined => current[key];

export const getPreviews = (): Preview => current;

/** Calls `listener` when a preview changes; returns the way to stop. */
export function subscribePreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget everything (for tests). */
export function clearAllPreviews(): void {
  current = {};
  emit();
}
