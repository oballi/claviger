import { useEffect } from "react";
import type { PopupSize } from "../contract/views";

/** Chrome and Firefox cap a popup at 800x600. */
export const POPUP_DIMENSIONS: Record<PopupSize, readonly [width: number, height: number]> = {
  small: [320, 460],
  medium: [360, 540],
  large: [420, 600],
};

// Full class strings: Tailwind only emits classes it can find verbatim.
export const POPUP_SIZE_CLASS: Record<PopupSize, string> = {
  small: "h-[460px] w-[320px]",
  medium: "h-[540px] w-[360px]",
  large: "h-[600px] w-[420px]",
};

// The vault setting is async; this mirror lets the first paint use the right size.
const CACHE_KEY = "claviger-popup-size";

const isSize = (v: unknown): v is PopupSize => v === "small" || v === "medium" || v === "large";

export function readCachedPopupSize(): PopupSize {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (isSize(cached)) return cached;
  } catch {
    // Storage can be blocked; fall back to the default size.
  }
  return "medium";
}

/** The popup cannot resize once open; the new size is mirrored for the next open. */
export function usePopupSizeSync(size: PopupSize | undefined): void {
  useEffect(() => {
    if (!isSize(size)) return;
    try {
      localStorage.setItem(CACHE_KEY, size);
    } catch {
      // Ignored: the stored setting still applies after the next load.
    }
  }, [size]);
}
