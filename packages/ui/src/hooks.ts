import { useCallback, useEffect, useRef, useState } from "react";
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
  // The list is stored with the page it was requested for, so a list for another tab is never
  // returned: "This site" matches would otherwise show against the wrong site.
  const [loaded, setLoaded] = useState<{ url: string | undefined; list: AccountListView } | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);

  // Set by real input; only that makes a load count as activity for the background auto-lock.
  const activeRef = useRef(false);
  useEffect(() => {
    const mark = () => {
      activeRef.current = true;
    };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("keydown", mark, true);
    return () => {
      document.removeEventListener("pointerdown", mark, true);
      document.removeEventListener("keydown", mark, true);
    };
  }, []);

  // Responses older than the latest request or for a previous page are dropped.
  const seqRef = useRef(0);
  const load = useCallback(
    async (passive: boolean) => {
      if (pageUrl === null) return;
      const mine = ++seqRef.current;
      try {
        const next = await rpc("listAccounts", {
          ...(pageUrl ? { pageUrl } : {}),
          ...(passive ? { passive } : {}),
        });
        if (mine !== seqRef.current) return;
        setLoaded({ url: pageUrl, list: next });
        setError(null);
      } catch (e) {
        if (mine === seqRef.current) setError(e);
      }
    },
    [rpc, pageUrl],
  );

  const reload = useCallback(() => load(false), [load]);

  const firstLoadRef = useRef(true);
  useEffect(() => {
    if (pageUrl === null) return;
    // The first load is the user opening the view; later page changes come from tab events,
    // which must not postpone the auto-lock unless the user was active meanwhile.
    const passive = !firstLoadRef.current && !activeRef.current;
    firstLoadRef.current = false;
    activeRef.current = false;
    void load(passive);
    if (pollMs <= 0) return;
    const id = setInterval(() => {
      const passive = !activeRef.current;
      activeRef.current = false;
      void load(passive);
    }, pollMs);
    return () => clearInterval(id);
  }, [load, pollMs, pageUrl]);

  const list = loaded && loaded.url === pageUrl ? loaded.list : null;
  return { list, error, reload };
}
