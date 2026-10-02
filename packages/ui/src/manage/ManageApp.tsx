import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ServiceState } from "../contract/views";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { LockScreen } from "../components/LockScreen";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi, type ManageRoute } from "../platform";
import { useThemeSync } from "../theme";
import { AccountsScreen } from "./AccountsScreen";
import { CorruptScreen } from "./CorruptScreen";
import { BackupScreen, type ImportSource } from "./BackupScreen";
import { ImportScreen } from "./ImportScreen";
import { ManageFrame, PageTitle } from "./ManageFrame";
import { RecoverScreen } from "./RecoverScreen";
import { SecurityScreen } from "./SecurityScreen";
import { SetupWizard } from "./SetupWizard";

const ROUTES: readonly ManageRoute[] = [
  "setup",
  "recover",
  "accounts",
  "security",
  "backup",
  "import",
];

export function parseRoute(hash: string): ManageRoute | null {
  const name = hash.replace(/^#\/?/, "");
  return (ROUTES as readonly string[]).includes(name) ? (name as ManageRoute) : null;
}

function useHashRoute(): [ManageRoute | null, (route: ManageRoute) => void] {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = useCallback((next: ManageRoute) => {
    window.location.hash = `#/${next}`;
    setRoute(next);
  }, []);
  return [route, navigate];
}

function Narrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen justify-center bg-bg font-sans text-text">
      <div className="flex w-full max-w-[420px] flex-col py-16">{children}</div>
    </div>
  );
}

export function ManageApp({ pollMs = 2000 }: { pollMs?: number }) {
  const { rpc } = useUi();
  const t = useT();
  const [route, navigate] = useHashRoute();
  const [state, setState] = useState<ServiceState | null>(null);
  useThemeSync(state?.theme);
  const [error, setError] = useState<string | null>(null);
  // Setup and recovery continue after the vault opens (the one-time recovery code is still on
  // screen); polling must not swap them for the signed-in pages and lose that code.
  const [flow, setFlow] = useState<"setup" | "recover" | null>(null);
  // Set once this tab itself submits setup/recovery. Without it, a tab that merely saw the vault
  // appear (another tab finished setup) would stay on a wizard with nothing to show.
  const startedRef = useRef(false);
  const [pendingImport, setPendingImport] = useState<ImportSource | null>(null);

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
    if (pollMs <= 0) return;
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  useEffect(() => {
    if (state?.status === "no-vault") setFlow("setup");
    else if (state?.status === "locked" && route === "recover") setFlow("recover");
  }, [state?.status, route]);

  const unlocked = state?.status === "unlocked";
  const keepSetup =
    state !== null &&
    state.status !== "unsupported" &&
    state.status !== "corrupt" &&
    (state.status === "no-vault" || (flow === "setup" && startedRef.current));
  const keepRecover = flow === "recover" && startedRef.current;
  // A refresh failure after a failed lock still has to show the real status.
  const lock = () => void rpc("lock", {}).then(refresh, refresh);

  // The import preview needs its source; keeping it after leaving would resurrect a stale file.
  useEffect(() => {
    if (route !== "import" || state?.status !== "unlocked") setPendingImport(null);
  }, [route, state?.status]);

  // "#/setup" only makes sense while a vault is being created or found.
  useEffect(() => {
    if (unlocked && route === "setup" && !keepSetup) navigate("accounts");
  }, [unlocked, route, keepSetup, navigate]);

  let page: ReactNode;
  if (!state) {
    page = (
      <ManageFrame active={null}>
        <p className="m-0 text-sm text-muted">{error ? "" : t("common.loading")}</p>
      </ManageFrame>
    );
  } else if (keepSetup) {
    page = (
      <SetupWizard
        key="setup"
        onCreating={() => {
          startedRef.current = true;
        }}
        onFinished={(next) => {
          startedRef.current = false;
          setFlow(null);
          navigate(next);
          void refresh();
        }}
      />
    );
  } else if (state.status === "unsupported" || state.status === "corrupt") {
    page = (
      <ManageFrame active={null}>
        <PageTitle
          title={
            state.status === "corrupt" ? t("status.corrupt.title") : t("status.unsupported.title")
          }
        >
          {state.status === "corrupt" ? t("manage.corrupt") : t("status.unsupported.body")}
        </PageTitle>
        {state.status === "corrupt" ? (
          <CorruptScreen
            storageArea={state.storageArea}
            onDone={() => void refresh().then(() => navigate("setup"))}
          />
        ) : null}
      </ManageFrame>
    );
  } else if (route === "recover" && (state.status === "locked" || (keepRecover && unlocked))) {
    page = (
      <ManageFrame active={null}>
        <RecoverScreen
          hasRecoveryCode={state.hasRecoveryCode}
          onSubmitting={() => {
            startedRef.current = true;
          }}
          onDone={() => {
            startedRef.current = false;
            setFlow(null);
            navigate("accounts");
            void refresh();
          }}
          onCancel={() => {
            startedRef.current = false;
            setFlow(null);
            navigate("accounts");
          }}
        />
      </ManageFrame>
    );
  } else if (state.status === "locked") {
    page = (
      <Narrow>
        <LockScreen
          state={state}
          title={route === "setup" ? t("manage.found") : undefined}
          onUnlocked={() => void refresh()}
          onForgot={() => navigate("recover")}
        />
      </Narrow>
    );
  } else {
    const active: ManageRoute =
      route === "security" || route === "backup" || route === "import" ? route : "accounts";
    let content: ReactNode;
    if (active === "security") {
      content = (
        <SecurityScreen
          state={state}
          onChanged={() => void refresh()}
          onDeleted={() => void refresh().then(() => navigate("setup"))}
        />
      );
    } else if (active === "import" && pendingImport) {
      content = (
        <ImportScreen
          source={pendingImport}
          onDone={() => {
            setPendingImport(null);
            navigate("accounts");
          }}
          onCancel={() => {
            setPendingImport(null);
            navigate("backup");
          }}
        />
      );
    } else if (active === "backup" || active === "import") {
      content = (
        <BackupScreen
          state={state}
          onChanged={() => void refresh()}
          onImport={(source) => {
            setPendingImport(source);
            navigate("import");
          }}
        />
      );
    } else {
      content = <AccountsScreen state={state} onChanged={() => void refresh()} />;
    }
    page = (
      <ManageFrame active={active === "import" ? "backup" : active} onLock={lock}>
        {content}
      </ManageFrame>
    );
  }

  // A failed poll (e.g. the worker restarting) must not unmount the current page: the last
  // good state keeps rendering and the error shows in a banner above it.
  return (
    <ErrorBoundary message={t("common.crashed")} retryLabel={t("common.retry")}>
      <p
        role="alert"
        className={error ? "m-0 bg-bg px-6 py-3 text-center text-sm text-warn" : "sr-only"}
      >
        {error}
      </p>
      {page}
    </ErrorBoundary>
  );
}
