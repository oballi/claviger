import { useEffect } from "react";
import type { Theme } from "./contract/views";

// The vault setting is async; this mirror lets the first paint use the right theme.
const CACHE_KEY = "otp-vault-theme";

const isTheme = (v: unknown): v is Theme => v === "system" || v === "light" || v === "dark";

/** "system" removes the attribute so the media query decides. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(CACHE_KEY, theme);
  } catch {
    // Storage can be blocked; the stored setting still applies after load.
  }
}

/** Call before the first render. */
export function applyCachedTheme(): void {
  const root = document.documentElement;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached === "light" || cached === "dark") {
      root.setAttribute("data-theme", cached);
      return;
    }
  } catch {
    // Storage can be blocked; fall back to the system theme.
  }
  root.removeAttribute("data-theme");
}

/** Reconciles the page with the stored setting once the state arrives (also while locked). */
export function useThemeSync(theme: Theme | undefined): void {
  useEffect(() => {
    if (isTheme(theme)) applyTheme(theme);
  }, [theme]);
}
