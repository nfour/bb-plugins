import { useSyncExternalStore } from "react";

/**
 * Numbers a slider in the settings panel shows while it is dragged, before they are saved. The page
 * applies them over the saved settings, so a reply restyles at frame rate under the pointer, and the
 * setting is written once when the slider is released.
 */
export type Preview = Readonly<Record<string, number>>;

let current: Preview = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function setPreview(key: string, value: number): void {
  if (current[key] === value) return;
  current = { ...current, [key]: value };
  emit();
}

export function clearPreview(key: string): void {
  if (!(key in current)) return;
  const { [key]: _gone, ...rest } = current;
  current = rest;
  emit();
}

export const getPreview = (key: string): number | undefined => current[key];

export function usePreview(): Preview {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
