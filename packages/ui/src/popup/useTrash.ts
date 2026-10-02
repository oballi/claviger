import { useCallback, useEffect, useState } from "react";
import type { TrashItemView } from "../contract/views";
import { useUi } from "../platform";

/** Secondary data: a failure leaves the bin empty instead of breaking the code list. */
export function useTrash() {
  const { rpc } = useUi();
  const [items, setItems] = useState<TrashItemView[]>([]);
  const reload = useCallback(async (): Promise<TrashItemView[]> => {
    try {
      const next = await rpc("listTrash", {});
      setItems(next);
      return next;
    } catch {
      return [];
    }
  }, [rpc]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, reload };
}
