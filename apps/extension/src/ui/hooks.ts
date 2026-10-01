import { useEffect, useState } from "react";

/**
 * Re-renders every `intervalMs` while it is > 0 and returns the current time. Reading the clock
 * at render (not from state) keeps a countdown right on the render that starts it.
 */
export function useNow(intervalMs: number): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (intervalMs <= 0) return;
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return Date.now();
}
