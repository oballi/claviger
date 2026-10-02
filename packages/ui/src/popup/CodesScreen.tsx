import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { AccountView, ServiceState, StorageUsageView, TrashItemView } from "../contract/views";
import { RpcError } from "../rpc/client";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Toast } from "../components/Toast";
import { UndoToast } from "../components/UndoToast";
import { errorMessage } from "../errors";
import { useAccountList } from "../hooks";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { AccountRow, type FillPrompt } from "./AccountRow";
import type { MenuItem } from "./RowMenu";
import { AddAccount } from "./AddAccount";

import { GroupSection } from "./GroupSection";
import { useCollapsed } from "./useCollapsed";
import { useTrash } from "./useTrash";
import { NO_GROUP_KEY, sectionsOf } from "../groups";

const EditAccount = lazy(() => import("./EditAccount").then((m) => ({ default: m.EditAccount })));
const TrashList = lazy(() => import("./TrashList").then((m) => ({ default: m.TrashList })));

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
  const { rpc, copy, activeTab, openManage, capabilities } = useUi();
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<{ id: number; url: string } | undefined | null>(null);
  const pageUrl = tab === null ? null : tab?.url;
  const [filling, setFilling] = useState(false);
  const fillingRef = useRef(false);
  const [fillPrompt, setFillPrompt] = useState<{ id: string; kind: FillPrompt } | null>(null);
  const { list, error, reload } = useAccountList(pageUrl, pollMs);
  const [query, setQuery] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [refocus, setRefocus] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsageView | null>(null);
  const { collapsed, toggle } = useCollapsed();
  const searchRef = useRef<HTMLInputElement>(null);
  const deleting = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const clearToast = useCallback(() => setToast(null), []);
  const [undo, setUndo] = useState<{ id: string; name: string; focus: boolean } | null>(null);
  const trash = useTrash();
  const [showTrash, setShowTrash] = useState(false);
  const [focusSearch, setFocusSearch] = useState(false);
  // Last input modality: only a keyboard delete moves focus to "Undo" (the confirm button is gone).
  const viaKeyboard = useRef(false);
  const clearUndo = useCallback(() => setUndo(null), []);

  useEffect(() => {
    (capabilities.activeTab ? activeTab() : Promise.resolve(undefined)).then(setTab, () =>
      setTab(undefined),
    );
    rpc("storageUsage", {}).then(setUsage, () => setUsage(null));
  }, [activeTab, capabilities.activeTab, rpc]);

  useEffect(() => {
    if (error instanceof RpcError && error.code === "locked") onLocked();
  }, [error, onLocked]);

  // A stale offer must not reappear when the list view returns.
  const away = adding || editing !== null || showTrash;
  useEffect(() => {
    if (away) setUndo(null);
  }, [away]);

  // "/" must work as soon as the popup opens, when focus is still on <body> (spec §6.2).
  useEffect(() => {
    if (adding || editing || showTrash) return;
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.closest("input, textarea, select")) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [adding, editing, showTrash]);

  // A row can move to another section (and remount), so focus returns to its menu trigger by id.
  useEffect(() => {
    if (!refocus) return;
    const root = listRef.current;
    const trigger = root?.querySelector<HTMLElement>(`[data-menu-for="${CSS.escape(refocus)}"]`);
    if (trigger) trigger.focus();
    else {
      // The row went into a collapsed group, so its header is the nearest place left.
      const key = list?.accounts.find((a) => a.id === refocus)?.groupId ?? NO_GROUP_KEY;
      root?.querySelector<HTMLElement>(`[data-group-for="${CSS.escape(key)}"]`)?.focus();
    }
    setRefocus(null);
  }, [list, refocus]);

  // The bin emptied while its view was open: go back to the list.
  useEffect(() => {
    if (!showTrash || trash.items.length > 0) return;
    setShowTrash(false);
    setActionError(null);
    setFocusSearch(true);
  }, [showTrash, trash.items.length]);

  // The search field only exists once the list view has rendered again.
  useEffect(() => {
    if (!focusSearch || showTrash || adding || editing) return;
    searchRef.current?.focus();
    setFocusSearch(false);
  }, [focusSearch, showTrash, adding, editing, list]);

  // An account deleted elsewhere must not leave the edit view blank or silently vanish.
  const gone = editing !== null && list !== null && !list.accounts.some((a) => a.id === editing);
  useEffect(() => {
    if (!gone) return;
    setEditing(null);
    setActionError(t("edit.gone"));
  }, [gone, t]);

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

  if (showTrash) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Suspense fallback={null}>
          <TrashList
            items={trash.items}
            error={actionError}
            onBack={() => {
              setShowTrash(false);
              setActionError(null);
              setFocusSearch(true);
            }}
            onRestore={restoreFromList}
          />
        </Suspense>
        <Toast message={toast} onDone={clearToast} />
      </div>
    );
  }

  const accounts = list?.accounts ?? [];
  const editTarget = editing ? accounts.find((a) => a.id === editing) : undefined;
  if (editTarget) {
    const back = () => {
      setEditing(null);
      setRefocus(editTarget.id);
    };
    return (
      <Suspense fallback={null}>
        <EditAccount
          account={editTarget}
          groups={list?.groups ?? []}
          onBack={back}
          onSaved={(name) => {
            back();
            setToast(t("accounts.saved", { name }));
            void reload();
          }}
        />
      </Suspense>
    );
  }
  const exact = new Set(list?.matches.exact ?? []);
  const suggested = new Set(list?.matches.suggested ?? []);
  const remembered = new Set(list?.matches.remembered ?? []);
  const onSite = (a: AccountView) => exact.has(a.id) || suggested.has(a.id) || remembered.has(a.id);
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

  async function fill(account: AccountView, confirmedDomain?: string) {
    // The ref blocks a second click before the disabled state has rendered.
    if (fillingRef.current) return;
    fillingRef.current = true;
    setFilling(true);
    try {
      await doFill(account, confirmedDomain);
    } finally {
      fillingRef.current = false;
      setFilling(false);
    }
  }

  async function doFill(account: AccountView, confirmedDomain?: string) {
    setActionError(null);
    setFillPrompt(null);
    if (!tab) return;
    try {
      const { result, code } = await rpc("fillCode", {
        id: account.id,
        tabId: tab.id,
        ...(confirmedDomain ? { confirmedDomain } : {}),
      });
      if (result === "filled") {
        setToast(t("fill.done"));
        // Only a confirmed fill on an unlinked site offers to link it.
        if (confirmedDomain) setFillPrompt({ id: account.id, kind: "link" });
        void reload();
        return;
      }
      if (code === null) {
        setActionError(t("codes.copyFailed"));
        return;
      }
      try {
        await copy(code);
      } catch {
        setActionError(t("codes.copyFailed"));
        return;
      }
      rpc("clipboardCopied", {}).catch(() => {});
      setToast(t(result === "copied-instead" ? "fill.copiedNoField" : "fill.copiedRefused"));
    } catch (e) {
      if (e instanceof RpcError && e.code === "not-linked") {
        setFillPrompt({
          id: account.id,
          kind: state.fillOnlyLinked || !list?.pageDomain ? "blocked" : "confirm",
        });
        return;
      }
      setActionError(errorMessage(t, e));
    }
  }

  async function linkSite(account: AccountView) {
    setActionError(null);
    setFillPrompt(null);
    const domain = list?.pageDomain;
    if (!domain) return;
    try {
      await rpc("updateAccount", {
        id: account.id,
        patch: { domains: [...new Set([...account.domains, domain])] },
      });
      setToast(t("fill.linked"));
      await reload();
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
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
    viaKeyboard.current = true;
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

  async function act(action: () => Promise<unknown>, message?: string, focusId?: string) {
    setActionError(null);
    try {
      await action();
      if (message) setToast(message);
      await reload();
      if (focusId) setRefocus(focusId);
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
  }

  async function removeAccount(account: AccountView) {
    const name = account.issuer || account.label;
    const keyboard = viaKeyboard.current;
    setActionError(null);
    try {
      await rpc("deleteAccount", { id: account.id });
      setConfirmDelete(null);
      await reload();
      // The bin is best effort: offer "Undo" only when the entry really is there.
      const binned = (await trash.reload()).some((i) => i.id === account.id);
      // The confirm button is gone; focus lands on "Undo" (keyboard) or the search field.
      if (!(binned && keyboard)) searchRef.current?.focus();
      if (binned) {
        setToast(null);
        setUndo({ id: account.id, name, focus: keyboard });
      } else {
        setToast(t("accounts.deleted", { name }));
      }
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
  }

  async function undoDelete() {
    if (!undo) return;
    const { id, name } = undo;
    setUndo(null);
    searchRef.current?.focus();
    try {
      await rpc("restoreTrash", { id });
      setToast(t("trash.restored", { name }));
      await Promise.all([reload(), trash.reload()]);
    } catch (e) {
      setActionError(errorMessage(t, e));
      void trash.reload();
    }
  }

  async function restoreFromList(item: TrashItemView) {
    setActionError(null);
    try {
      const restored = await rpc("restoreTrash", { id: item.id });
      setToast(t("trash.restored", { name: restored.name || t("add.unnamed") }));
      await Promise.all([reload(), trash.reload()]);
    } catch (e) {
      setActionError(errorMessage(t, e));
      // The entry may be gone (expired or removed elsewhere): the list must not keep offering it.
      await trash.reload();
    }
  }

  function menuFor(account: AccountView): MenuItem[] {
    const name = account.issuer || account.label;
    const groups = list?.groups ?? [];
    const items: MenuItem[] = [];
    if (domain && !account.domains.includes(domain))
      items.push({
        key: "link",
        label: t("menu.linkSite"),
        hint: domain,
        onSelect: () => void linkSite(account),
      });
    items.push({
      key: "pin",
      label: account.pinned ? t("account.unpin") : t("account.pin"),
      onSelect: () =>
        void act(
          () => rpc("setPinned", { id: account.id, pinned: !account.pinned }),
          t(account.pinned ? "accounts.unpinned" : "accounts.pinned", { name }),
          account.id,
        ),
    });
    items.push({
      key: "edit",
      label: t("menu.edit"),
      onSelect: () => setEditing(account.id),
    });
    if (groups.length > 0)
      items.push({
        key: "group",
        label: t("menu.moveToGroup"),
        sub: [...groups, { id: "", name: t("group.none") }].map((g) => ({
          key: `g:${g.id}`,
          label: g.name,
          disabled: (account.groupId ?? "") === g.id,
          onSelect: () =>
            void act(
              () => rpc("setAccountGroup", { id: account.id, groupId: g.id || null }),
              t("accounts.moved", { name }),
              account.id,
            ),
        })),
      });
    items.push({
      key: "delete",
      label: t("menu.delete"),
      danger: true,
      onSelect: () => setConfirmDelete(account.id),
    });
    return items;
  }

  const row = (account: AccountView, large = false) => (
    <AccountRow
      key={account.id}
      account={account}
      large={large}
      suggested={suggested.has(account.id)}
      remembered={remembered.has(account.id)}
      pinnedMark={grouped}
      fill={
        large && tab && capabilities.autofill
          ? {
              prompt: fillPrompt?.id === account.id ? fillPrompt.kind : null,
              busy: filling,
              domain: list?.pageDomain ?? null,
              onFill: (a) => void fill(a),
              onConfirm: (a) => void fill(a, list?.pageDomain ?? undefined),
              onCancel: () => setFillPrompt(null),
              onLink: (a) => void linkSite(a),
              onOpenSecurity: () => openManage("security"),
            }
          : undefined
      }
      menu={menuFor(account)}
      confirmDelete={
        confirmDelete === account.id
          ? {
              onConfirm: () => {
                if (deleting.current) return;
                deleting.current = true;
                void removeAccount(account).finally(() => {
                  deleting.current = false;
                });
              },
              onCancel: () => {
                setConfirmDelete(null);
                setRefocus(account.id);
              },
            }
          : undefined
      }
      mode={state.viewMode}
      onCopy={(a) => void copyCode(a)}
      onNextHotp={(a) => void nextHotp(a)}
    />
  );

  const trashLink =
    trash.items.length > 0 ? (
      <Button
        variant="link"
        onClick={() => {
          setActionError(null);
          setUndo(null);
          setShowTrash(true);
        }}
        className="mt-3 justify-start text-xs text-muted"
      >
        {t("trash.link", { count: trash.items.length })}
      </Button>
    ) : null;
  const validKeys = [NO_GROUP_KEY, ...(list?.groups.map((g) => g.id) ?? [])];
  const grouped = (list?.groups.length ?? 0) > 0;
  const siteRows = accounts.filter(onSite);
  const pinnedRows = accounts.filter((a) => a.pinned && !onSite(a));
  const otherRows = accounts.filter((a) => !a.pinned && !onSite(a));

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onKeyDown={onListKeyDown}
      onPointerDown={() => (viaKeyboard.current = false)}
    >
      <header className="flex items-center pt-2 pr-3 pl-7">
        <div className="flex-1 font-mono text-xs tracking-wide">{t("app.name")}</div>
        <button
          type="button"
          aria-label={t("codes.manage")}
          className={iconButton}
          onClick={() => openManage()}
        >
          <Icon name="settings" size={17} />
        </button>
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
      {state.clockOffsetSec !== 0 ? (
        <div className="px-7">
          <Button
            variant="link"
            onClick={() => openManage("security")}
            className="text-xs text-muted"
          >
            {t("clock.popupNote", { offset: state.clockOffsetSec })}
          </Button>
        </div>
      ) : null}
      <div className="px-7 pt-1">
        <div className="ov-line flex h-11 items-center gap-2.5 border-b border-hair">
          <Icon name="search" size={15} className="text-muted" />
          <input
            ref={searchRef}
            type="search"
            data-bare=""
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
            {trashLink}
            <p className="m-0 text-sm text-muted">{t("codes.empty")}</p>
            {state.snapshotOffer && trash.loaded && trash.items.length === 0 ? (
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
            {list && grouped ? (
              sectionsOf(
                accounts.filter((a) => !onSite(a)),
                list.groups,
              ).map((s) => {
                const key = s.group?.id ?? NO_GROUP_KEY;
                return (
                  <GroupSection
                    key={key}
                    groupKey={key}
                    title={s.group?.name ?? t("group.none")}
                    count={s.rows.length}
                    open={!collapsed.has(key)}
                    onToggle={() => toggle(key, validKeys)}
                  >
                    {s.rows.map((a) => row(a))}
                  </GroupSection>
                );
              })
            ) : (
              <>
                {pinnedRows.length > 0 ? (
                  <Section title={t("codes.pinned")}>{pinnedRows.map((a) => row(a))}</Section>
                ) : null}
                {otherRows.length > 0 ? (
                  <Section title={t("codes.all")}>{otherRows.map((a) => row(a))}</Section>
                ) : null}
              </>
            )}
          </>
        )}
        {accounts.length > 0 ? trashLink : null}
      </div>
      <Toast message={toast} onDone={clearToast} raised={undo !== null} />
      <UndoToast
        token={undo?.id}
        message={undo ? t("trash.deleted", { name: undo.name }) : null}
        autoFocus={undo?.focus}
        onUndo={() => void undoDelete()}
        onDone={clearUndo}
        onDismiss={() => {
          setUndo(null);
          searchRef.current?.focus();
        }}
      />
    </div>
  );
}
