import { useCallback, useEffect, useState } from "react";
import type { ServiceState } from "../../background/vaultService";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LockScreen } from "../components/LockScreen";
import { StatusScreen } from "../components/StatusScreen";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { CodesScreen } from "./CodesScreen";

export function PopupApp({ pollMs = 1000 }: { pollMs?: number }) {
  const { rpc, openManage } = useUi();
  const t = useT();
  const [state, setState] = useState<ServiceState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await rpc("getState", {}));
      setError(null);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [rpc, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  let content;
  if (error) {
    content = (
      <p role="alert" className="m-auto px-7 text-sm text-warn">
        {error}
      </p>
    );
  } else if (!state) {
    content = <p className="m-auto text-sm text-muted">{t("common.loading")}</p>;
  } else if (state.status === "no-vault") {
    content = (
      <StatusScreen
        title={t("status.noVault.title")}
        body={t("status.noVault.body")}
        actionLabel={t("status.noVault.action")}
        onAction={() => openManage("setup")}
      />
    );
  } else if (state.status === "unsupported") {
    content = (
      <StatusScreen title={t("status.unsupported.title")} body={t("status.unsupported.body")} />
    );
  } else if (state.status === "corrupt") {
    content = (
      <StatusScreen
        title={t("status.corrupt.title")}
        body={t("status.corrupt.body")}
        actionLabel={t("status.corrupt.action")}
        onAction={() => openManage()}
      />
    );
  } else if (state.status === "locked") {
    content = (
      <LockScreen
        state={state}
        onUnlocked={() => void refresh()}
        onForgot={() => openManage("recover")}
        onChangePolicy={() => openManage("security")}
      />
    );
  } else {
    content = <CodesScreen pollMs={pollMs} onLocked={() => void refresh()} />;
  }

  return (
    <div className="relative flex h-[540px] w-[360px] flex-col overflow-hidden bg-bg font-sans text-text">
      <ErrorBoundary message={t("common.crashed")} retryLabel={t("common.retry")}>
        {content}
      </ErrorBoundary>
    </div>
  );
}
