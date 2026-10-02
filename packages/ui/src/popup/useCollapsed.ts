import { useCallback, useState } from "react";

const KEY = "claviger.popup.collapsed";
// Renamed from the earlier product name; migrated once on read.
const LEGACY_KEY = "otpv.popup.collapsed";
const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 64;

function read(): Set<string> {
  try {
    let stored = localStorage.getItem(KEY);
    if (stored === null) {
      const old = localStorage.getItem(LEGACY_KEY);
      if (old !== null) {
        localStorage.setItem(KEY, old);
        stored = old;
        localStorage.removeItem(LEGACY_KEY);
      }
    }
    const raw: unknown = JSON.parse(stored ?? "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(
      raw
        .slice(0, MAX_KEYS)
        .filter((x): x is string => typeof x === "string" && x.length <= MAX_KEY_LENGTH),
    );
  } catch {
    return new Set();
  }
}

/** Per-device UI state; storage may be blocked, then the sections simply start expanded. */
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(read);
  // `valid` prunes keys of deleted groups so the stored set cannot grow without bound.
  const toggle = useCallback((key: string, valid: readonly string[]) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
      for (const k of next) if (!valid.includes(k)) next.delete(k);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Blocked storage only loses the remembered state.
      }
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
