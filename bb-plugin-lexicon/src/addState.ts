import { useSyncExternalStore } from "react";

/** A request to add the text a reader selected to the lexicon: the thread it came from and the words. */
export interface AddRequest {
  text: string;
  threadId: string;
  /** Distinguishes one opening from the next, so a new request starts a fresh form. */
  at: number;
}

let current: AddRequest | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Opens the add dialog (the message action calls this; the dialog itself is an overlay). */
export function openAdd(text: string, threadId: string): void {
  current = { text, threadId, at: Date.now() };
  emit();
}

export function closeAdd(): void {
  current = null;
  emit();
}

export function useAddRequest(): AddRequest | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => current,
  );
}
