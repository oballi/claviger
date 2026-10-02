import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { AccountView, ServiceState, StorageUsageView } from "../../background/vaultService";
import { RpcError } from "../../rpc/client";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Toast } from "../components/Toast";
import { errorMessage } from "../errors";
import { useAccountList } from "../hooks";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { AccountRow } from "./AccountRow";
import { AddAccount } from "./AddAccount";

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={aside ? `${title} · ${aside}` : title}>
      <h2 className="m-0 flex items-baseline justify-between pt-[22px] pb-1 text-[11px] font-normal text-muted">
        <span>{title}</span>
        {aside ? <span className="font-mono">{aside}</span> : null}
      </h2>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

const iconButton =
  "flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text hover:bg-hair";

/** Sync quota pressure: total bytes, or the index item nearing the per-item limit (spec §7). */
function quotaPercent(usage: StorageUsageView | null): number | null {
  if (!usage?.quotaBytes || !usage.maxItemBytes) return null;
  const ratio = Math.max(usage.bytes / usage.quotaBytes, usage.indexBytes / usage.maxItemBytes);
  return ratio >= 0.8 ? Math.round(ratio * 100) : null;
}

export function CodesScreen({
  state,
  pollMs,
  onLocked,
}: {
  state: ServiceState;
  pollMs: number;
  onLocked: () => void;
}) {
  const { rpc, copy, activeTabUrl, openManage } = useUi();
  const t = useT();
  const locale = useLocale();
  const [pageUrl, setPageUrl] = useState<string | undefined | null>(null);
  const { list, error, reload } = useAccountList(pageUrl, pollMs);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsageView | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const clearToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    activeTabUrl().then(setPageUrl, () => setPageUrl(undefined));
    rpc("storageUsage", {}).then(setUsage, () => setUsage(null));
  }, [activeTabUrl, rpc]);

  useEffect(() => {
    if (error instanceof RpcError && error.code === "locked") onLocked();
  }, [error, onLocked]);

  // "/" must work as soon as the popup opens, when focus is still on <body> (spec §6.2).
  useEffect(() => {
    if (adding) return;
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea, select")) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [adding]);

  if (adding) {
    return (
      <AddAccount
        tabUrl={pageUrl ?? undefined}
        tabDomain={list?.pageDomain}
        onBack={() => setAdding(false)}
        onAdded={(name) => {
          setAdding(false);
          setToast(t("codes.added", { issuer: name }));
          void reload();
        }}
      />
    );
  }

  const accounts = list?.accounts ?? [];
  const exact = new Set(list?.matches.exact ?? []);
  const suggested = new Set(list?.matches.suggested ?? []);
  const onSite = (a: AccountView) => exact.has(a.id) || suggested.has(a.id);
  const q = query.trim().toLocaleLowerCase(locale);
  const filtered = q
    ? accounts.filter((a) =>
        `${a.issuer} ${a.label} ${a.domains.join(" ")}`.toLocaleLowerCase(locale).includes(q),
      )
    : null;
  const domain = list?.pageDomain ?? null;
  const quota = quotaPercent(usage);
  const listError = error && !(error instanceof RpcError && error.code === "locked");

  async function copyCode(account: AccountView) {
    setActionError(null);
    try {
      await copy(account.code);
    } catch {
      setActionError(t("codes.copyFailed"));
      return;
    }
    setToast(t("codes.copied", { issuer: account.issuer || account.label }));
    // Clearing is best effort; a failed report must not turn a good copy into an error.
    rpc("clipboardCopied", {}).catch(() => {});
  }

  async function nextHotp(account: AccountView) {
    setActionError(null);
    try {
      await rpc("nextHotp", { id: account.id });
      await reload();
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
  }

  async function lock() {
    setActionError(null);
    try {
      await rpc("lock", {});
      onLocked();
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && query) {
      event.preventDefault();
      setQuery("");
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>("[data-code-button]") ?? [],
    );
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % buttons.length
        : index <= 0
          ? buttons.length - 1
          : index - 1;
    buttons[next]?.focus();
  }

  const row = (account: AccountView, large = false) => (
    <AccountRow
      key={account.id}
      account={account}
      large={large}
      suggested={suggested.has(account.id)}
      mode={state.viewMode}
      onCopy={(a) => void copyCode(a)}
      onNextHotp={(a) => void nextHotp(a)}
    />
  );

  const siteRows = accounts.filter(onSite);
  const pinnedRows = accounts.filter((a) => a.pinned && !onSite(a));
  const otherRows = accounts.filter((a) => !a.pinned && !onSite(a));

  return (
    <div className="relative flex min-h-0 flex-1 flex-col" onKeyDown={onListKeyDown}>
      <header className="flex items-center pt-2 pr-3 pl-7">
        <div className="flex-1 font-mono text-xs tracking-wide">{t("app.name")}</div>
        <button
          type="button"
          aria-label={t("codes.add")}
          className={iconButton}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={18} />
        </button>
        <button
          type="button"
          aria-label={t("codes.lock")}
          className={iconButton}
          onClick={() => void lock()}
        >
          <Icon name="lock" size={17} />
        </button>
      </header>
      <div className="px-7 pt-1">
        <div className="flex h-11 items-center gap-2.5 border-b border-hair">
          <Icon name="search" size={15} className="text-muted" />
          <input
            ref={searchRef}
            type="search"
            aria-label={t("codes.search")}
            placeholder={t("codes.searchPlaceholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-text outline-none"
          />
          <kbd aria-hidden="true" className="font-mono text-[11px] text-muted">
            /
          </kbd>
        </div>
      </div>
      {list && (list.unreadable.length > 0 || list.indexDamaged) ? (
        <Button
          variant="link"
          onClick={() => openManage("accounts")}
          className="mx-7 justify-start text-xs text-warn"
        >
          {t("codes.problem")}
        </Button>
      ) : null}
      {quota !== null ? (
        <Button
          variant="link"
          onClick={() => openManage("backup")}
          className="mx-7 justify-start text-xs text-warn"
        >
          {t("codes.quota", { percent: quota })}
        </Button>
      ) : null}
      {listError ? (
        <p role="alert" className="m-0 px-7 pt-2 text-xs text-warn">
          {errorMessage(t, error)}
        </p>
      ) : null}
      {actionError ? (
        <p role="alert" className="m-0 px-7 pt-2 text-xs text-warn">
          {actionError}
        </p>
      ) : null}
      <div ref={listRef} className="min-h-0 flex-1 overflow-auto px-7 pb-[72px]">
        {list && accounts.length === 0 ? (
          <div className="flex flex-col items-start gap-4 pt-10">
            <p className="m-0 text-sm text-muted">{t("codes.empty")}</p>
            {state.snapshotOffer ? (
              <Button
                variant="link"
                onClick={() => openManage("backup")}
                className="justify-start text-[13px]"
              >
                {t(
                  state.snapshotOffer.accountCount === 1 ? "snapshots.offerOne" : "snapshots.offer",
                  { count: state.snapshotOffer.accountCount },
                )}
              </Button>
            ) : null}
            <Button variant="primary" onClick={() => setAdding(true)}>
              {t("codes.add")}
            </Button>
          </div>
        ) : null}
        {filtered ? (
          <Section title={t("codes.results")}>{filtered.map((a) => row(a))}</Section>
        ) : (
          <>
            {siteRows.length > 0 ? (
              <Section title={t("codes.thisSite")} aside={domain ?? undefined}>
                {siteRows.map((a) => row(a, true))}
              </Section>
            ) : null}
            {pinnedRows.length > 0 ? (
              <Section title={t("codes.pinned")}>{pinnedRows.map((a) => row(a))}</Section>
            ) : null}
            {otherRows.length > 0 ? (
              <Section title={t("codes.all")}>{otherRows.map((a) => row(a))}</Section>
            ) : null}
          </>
        )}
      </div>
      <Toast message={toast} onDone={clearToast} />
    </div>
  );
}
