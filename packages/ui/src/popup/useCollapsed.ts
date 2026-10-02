import { useCallback, useState } from "react";

const KEY = "claviger.popup.collapsed";
// Renamed from the earlier product name; migrated once on read.
const LEGACY_KEY = "otpv.popup.collapsed";
const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 64;

function parse(stored: string | null): Set<string> | null {
  if (stored === null) return null;
  const raw: unknown = JSON.parse(stored);
  if (!Array.isArray(raw)) return null;
  return new Set(
    raw
      .slice(0, MAX_KEYS)
      .filter((x): x is string => typeof x === "string" && x.length <= MAX_KEY_LENGTH),
  );
}

function read(): Set<string> {
  try {
    const current = localStorage.getItem(KEY);
    const old = localStorage.getItem(LEGACY_KEY);
    if (old !== null) localStorage.removeItem(LEGACY_KEY);
    if (current === null && old !== null) {
      // A legacy value is validated before it is copied, never copied verbatim.
      let migrated: Set<string> | null = null;
      try {
        migrated = parse(old);
      } catch {
        // Invalid legacy JSON is dropped.
      }
      if (migrated) localStorage.setItem(KEY, JSON.stringify([...migrated]));
      return migrated ?? new Set();
    }
    return parse(current) ?? new Set();
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
