import { useSyncExternalStore } from "react";
import { getPreviews, subscribePreview, type Preview } from "./preview.ts";

/** The values being previewed: the same object until one changes. */
export function usePreview(): Preview {
  return useSyncExternalStore(subscribePreview, getPreviews);
}
