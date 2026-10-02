import { useCallback, useEffect, useState } from "react";
import type { TrashItemView } from "../contract/views";
import { useUi } from "../platform";

/** Secondary data: a failure leaves the bin empty instead of breaking the code list. */
export function useTrash() {
  const { rpc } = useUi();
  const [items, setItems] = useState<TrashItemView[]>([]);
  // Until the first answer the bin is unknown, so the empty state must not act on it.
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async (): Promise<TrashItemView[]> => {
    try {
      const next = await rpc("listTrash", {});
      setItems(next);
      return next;
    } catch {
      return [];
    } finally {
      setLoaded(true);
    }
  }, [rpc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, loaded, reload };
}
