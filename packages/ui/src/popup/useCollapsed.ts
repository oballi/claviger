import { useCallback, useState } from "react";

const KEY = "otpv.popup.collapsed";

function read(): Set<string> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Per-device UI state; storage may be blocked, then the sections simply start expanded. */
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(read);
  const toggle = useCallback((key: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) next.add(key);
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
