import { useCallback, useEffect, useState } from "react";
import type { AccountListView } from "./contract/views";
import { useUi } from "./platform";

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

/** Polls the account list. `pageUrl === null` means the active tab is not known yet: wait, so
 * the list doesn't render once without "This site" and then jump. */
export function useAccountList(pageUrl: string | undefined | null, pollMs: number) {
  const { rpc } = useUi();
  const [list, setList] = useState<AccountListView | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    if (pageUrl === null) return;
    try {
      setList(await rpc("listAccounts", pageUrl ? { pageUrl } : {}));
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [rpc, pageUrl]);

  useEffect(() => {
    void reload();
    if (pollMs <= 0 || pageUrl === null) return;
    const id = setInterval(() => void reload(), pollMs);
    return () => clearInterval(id);
  }, [reload, pollMs, pageUrl]);

  return { list, error, reload };
}
