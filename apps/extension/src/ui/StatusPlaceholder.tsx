import { useEffect, useState } from "react";
import type { ServiceState } from "../background/vaultService";
import { rpc } from "../platform/browserRpc";

/** Until the real UI in Plan 3: shows that the service is reachable and its status. */
export function StatusPlaceholder({ title }: { title: string }) {
  const [state, setState] = useState<ServiceState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    rpc("getState", {}).then(setState, (e: Error) => setError(e.message));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 16, minWidth: 320 }}>
      <h1 style={{ fontSize: 16 }}>{title}</h1>
      <p>{error ?? (state ? `Durum: ${state.status}` : "Yükleniyor…")}</p>
    </main>
  );
}
