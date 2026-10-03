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
import { BackupReminder } from "../components/BackupReminder";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { Toast } from "../components/Toast";
import { UndoToast } from "../components/UndoToast";
import { errorMessage } from "../errors";
import { useAccountList } from "../hooks";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { iconButton } from "./iconButton";
import { REVEAL_SECONDS } from "./reveal";

const COPIED_MS = 1200;

import { ThemeToggle } from "./ThemeToggle";
import { AccountRow } from "./AccountRow";
import type { MenuItem } from "./RowMenu";
import { AddAccount } from "./AddAccount";

import { GroupSection } from "./GroupSection";
import { useCollapsed } from "./useCollapsed";
import { useTrash } from "./useTrash";
import { NO_GROUP_KEY, sectionsOf } from "../groups";
import { swapOrder } from "../reorder";

const EditAccount = lazy(() => import("./EditAccount").then((m) => ({ default: m.EditAccount })));
const TrashList = lazy(() => import("./TrashList").then((m) => ({ default: m.TrashList })));
const SortList = lazy(() => import("./SortList").then((m) => ({ default: m.SortList })));

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
  const { rpc, copy, activeTab, onActiveTabChange, openManage, closePopup, capabilities } = useUi();
  const t = useT();
  const locale = useLocale();
  const [tab, setTab] = useState<{ id: number; url: string } | undefined | null>(null);
  const pageUrl = tab === null ? null : tab?.url;
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
  const [sorting, setSorting] = useState(false);
  const sortToggle = useRef<HTMLButtonElement>(null);
  // Last input modality: only a keyboard delete moves focus to "Undo" (the confirm button is gone).
  const viaKeyboard = useRef(false);
  const clearUndo = useCallback(() => setUndo(null), []);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchFocused = useRef(false);
  const [announced, setAnnounced] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedAnnounce, setCopiedAnnounce] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  // Entering sort mode drops a visible copy toast (it would sit on top of the sort list).
  useEffect(() => {
    if (sorting) setToast(null);
  }, [sorting]);
  const toggleReveal = (a: AccountView) => {
    setAnnounced(true);
    setRevealedId((id) => (id === a.id ? null : a.id));
  };

  useEffect(() => {
    if (!revealedId) return;
    const timer = setTimeout(() => {
      // The code button turns back into a mask; keep focus from falling to <body>.
      const active = document.activeElement;
      if (active?.matches("[data-code-button]"))
        active.closest("li")?.querySelector<HTMLElement>("[data-reveal-button]")?.focus();
      setRevealedId(null);
    }, REVEAL_SECONDS * 1000);
    const onHidden = () => {
      if (document.visibilityState === "hidden") setRevealedId(null);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [revealedId]);

  useEffect(() => {
    if (!capabilities.activeTab) {
      setTab(undefined);
      return;
    }
    let current = true;
    let latest = 0;
    // Always re-resolved, never reused: a stale "this site" would be a false trust signal.
    const resolve = () => {
      const mine = ++latest;
      const apply = (next: { id: number; url: string } | undefined) =>
        current && mine === latest && setTab(next);
      return activeTab().then(apply, () => apply(undefined));
    };
    void resolve();
    const unsubscribe = onActiveTabChange?.(() => {
      // Back to "unknown": until the new tab resolves the old match must not show, and the
      // list must wait instead of loading once for "no tab".
      latest++;
      setTab(null);
      void resolve();
    });
    return () => {
      current = false;
      unsubscribe?.();
    };
  }, [activeTab, onActiveTabChange, capabilities.activeTab]);

  useEffect(() => {
    rpc("storageUsage", {}).then(setUsage, () => setUsage(null));
  }, [rpc]);

  useEffect(() => {
    if (error instanceof RpcError && error.code === "locked") onLocked();
  }, [error, onLocked]);

  // A stale offer must not reappear when the list view returns.
  const away = adding || editing !== null || showTrash || sorting;
  useEffect(() => {
    if (away) {
      setUndo(null);
      setRevealedId(null);
    }
  }, [away]);

  // A revealed code must not survive a switch away from Hidden mode and back.
  useEffect(() => {
    if (state.viewMode !== "hidden") setRevealedId(null);
  }, [state.viewMode]);

  // Another view replaces the list, so the mode must not survive the round trip.
  useEffect(() => {
    if (adding || editing !== null || showTrash) setSorting(false);
  }, [adding, editing, showTrash]);

  // Document-level: focus can fall to <body> when a clicked arrow becomes disabled.
  useEffect(() => {
    if (!sorting) return;
    function onEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setSorting(false);
      sortToggle.current?.focus();
    }
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [sorting]);

  // Search takes focus once, on the first list render; poll reloads must never steal it back.
  useEffect(() => {
    if (searchFocused.current || !list) return;
    searchFocused.current = true;
    if (!adding && editing === null && !showTrash && !sorting) searchRef.current?.focus();
  }, [list, adding, editing, showTrash, sorting]);

  // The selection is the first visible row until the user moves it (or its row disappears).
  useEffect(() => {
    const ids = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-code-button]") ?? [],
      (b) => b.closest("li")?.getAttribute("data-account-id") ?? "",
    );
    const next = selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
    if (next !== selectedId) setSelectedId(next);
  });

  // "/" and plain characters go to search even while focus is still on <body> (spec §6.2).
  useEffect(() => {
    if (adding || editing || showTrash || sorting || confirmDelete !== null) return;
    function onKey(event: globalThis.KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key.length !== 1 || event.key === " ") return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (target?.closest("input, textarea, select, [role=menu], [role=dialog]")) return;
      event.preventDefault();
      if (event.key !== "/") setQuery((q) => q + event.key);
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [adding, editing, showTrash, sorting, confirmDelete]);

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
  const onSite = (a: AccountView) => exact.has(a.id);
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
      // Same view object the row rendered: inside the window the dimmed next code is what is copied.
      await copy(state.viewMode === "hidden" ? account.code : (account.nextCode ?? account.code));
    } catch {
      setActionError(t("codes.copyFailed"));
      return;
    }
    setCopiedId(account.id);
    setCopiedAnnounce(true);
    clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => {
      setCopiedId(null);
      setCopiedAnnounce(false);
    }, COPIED_MS);
    // Clearing is best effort; a failed report must not turn a good copy into an error.
    rpc("clipboardCopied", {}).catch(() => {});
  }

  async function fillSelected(account: AccountView) {
    setActionError(null);
    try {
      const tab = await activeTab();
      if (!tab || !capabilities.autofill) return setToast(t("codes.fillRefused"));
      const r = await rpc("fillAccount", { id: account.id, tabId: tab.id });
      if (r.result === "filled") {
        // Nothing else to do here; leaving the popup open would only cover the page.
        if (closePopup) closePopup();
        else setToast(t("codes.copiedShort"));
      } else if (r.result === "copied-instead" && r.code) {
        await copy(r.code);
        rpc("clipboardCopied", {}).catch(() => {});
        setToast(t("codes.fillCopied"));
      } else setToast(t("codes.fillRefused"));
    } catch (e) {
      if (e instanceof RpcError && e.code === "not-linked") setToast(t("codes.fillNotLinked"));
      else setActionError(errorMessage(t, e));
    }
  }

  async function linkSite(account: AccountView) {
    setActionError(null);
    const domain = list?.pageDomain;
    if (!domain) return;
    try {
      await rpc("updateAccount", {
        id: account.id,
        patch: { domains: [...new Set([...account.domains, domain])] },
      });
      setToast(t("codes.linked"));
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
    setRevealedId(null);
    try {
      await rpc("lock", {});
      onLocked();
    } catch (e) {
      setActionError(errorMessage(t, e));
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    viaKeyboard.current = true;
    if (event.key === "Escape" && sorting) {
      event.preventDefault();
      event.stopPropagation();
      setSorting(false);
      sortToggle.current?.focus();
      return;
    }
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      if (query) setQuery("");
      // A held key must not clear the search and then close the popup in one go.
      else if (!event.repeat) closePopup?.();
      return;
    }
    const selected = accounts.find((a) => a.id === selectedId);
    const onSearch = event.target === searchRef.current;
    if (
      event.key === "Enter" &&
      selected &&
      !event.nativeEvent.isComposing &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      (onSearch || (event.shiftKey && (event.target as HTMLElement).closest("[data-code-button]")))
    ) {
      // A focused code button keeps its own click for plain Enter, so only the search is handled here.
      event.preventDefault();
      if (event.shiftKey) void fillSelected(selected);
      else void copyCode(selected);
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

  // Unlike act(), the list reloads after a failure too: the move may have hit a stale row or group.
  async function actSort(action: () => Promise<unknown>, message: string) {
    setActionError(null);
    try {
      await action();
      setToast(message);
    } catch (e) {
      setActionError(errorMessage(t, e));
    } finally {
      await reload();
    }
  }

  async function moveInSort(id: string, groupId: string | null, beforeId: string | null) {
    const moved = accounts.find((a) => a.id === id);
    const name = moved ? moved.issuer || moved.label : "";
    const changed = (moved?.groupId ?? null) !== groupId;
    const groupName = list?.groups.find((g) => g.id === groupId)?.name ?? t("group.none");
    await actSort(
      () => rpc("moveAccount", { id, groupId, beforeId }),
      changed ? t("sort.movedTo", { name, group: groupName }) : t("accounts.moved", { name }),
    );
  }

  async function swapInSort(id: string, otherId: string) {
    const moved = accounts.find((a) => a.id === id);
    await actSort(
      () =>
        rpc("reorder", {
          order: swapOrder(
            accounts.map((a) => a.id),
            id,
            otherId,
          ),
        }),
      t("accounts.moved", { name: moved ? moved.issuer || moved.label : "" }),
    );
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
      pinnedMark={grouped}
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
      copied={copiedId === account.id}
      selected={selectedId === account.id}
      revealed={revealedId === account.id}
      onToggleReveal={toggleReveal}
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
      onFocus={(e) => {
        const id = (e.target as HTMLElement)
          .closest("[data-code-button]")
          ?.closest("li")
          ?.getAttribute("data-account-id");
        if (id) setSelectedId(id);
      }}
      onPointerDown={() => (viaKeyboard.current = false)}
    >
      {/* Announces the state only; the code itself must never reach a live region. */}
      <div aria-live="polite" className="sr-only">
        {revealedId
          ? t("codes.revealedAnnounce", { seconds: REVEAL_SECONDS })
          : announced
            ? t("codes.hiddenAnnounce")
            : ""}
      </div>
      <div aria-live="polite" className="sr-only">
        {copiedAnnounce ? t("codes.copiedShort") : ""}
      </div>
      <header className="flex items-center pt-2 pr-3 pl-7">
        <div className="flex-1 font-mono text-xs tracking-wide">{t("app.name")}</div>
        <button
          type="button"
          aria-label={t("codes.manage")}
          title={t("codes.manage")}
          className={iconButton}
          onClick={() => openManage()}
        >
          <Icon name="settings" size={17} />
        </button>
        <ThemeToggle theme={state.theme} onError={setActionError} />
        <button
          ref={sortToggle}
          type="button"
          aria-label={t("sort.toggle")}
          title={t("sort.toggle")}
          aria-pressed={sorting}
          className={`${iconButton} ${sorting ? "bg-btn text-btn-text" : ""}`}
          onClick={() => setSorting((on) => !on)}
        >
          <Icon name="sort" size={17} />
        </button>
        <button
          type="button"
          aria-label={t("codes.add")}
          title={t("codes.add")}
          className={iconButton}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={18} />
        </button>
        <button
          type="button"
          aria-label={t("codes.lock")}
          title={t("codes.lock")}
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
            onClick={() => openManage("preferences")}
            className="text-xs text-muted"
          >
            {t("clock.popupNote", { offset: state.clockOffsetSec })}
          </Button>
        </div>
      ) : null}
      {state.backupReminder && !sorting ? (
        <BackupReminder daysSince={state.backupReminder.daysSince} className="px-7 pt-1" />
      ) : null}
      {sorting ? null : (
        <div className="px-7 pt-1">
          <div className="ov-line flex h-11 items-center gap-2.5 border-b border-hair">
            <Icon name="search" size={15} className="text-muted" />
            <input
              ref={searchRef}
              type="search"
              data-bare=""
              aria-label={t("codes.search")}
              aria-activedescendant={selectedId ? `code-${selectedId}` : undefined}
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
      )}
      {!sorting && list && (list.unreadable.length > 0 || list.indexDamaged) ? (
        <Button
          variant="link"
          onClick={() => openManage("accounts")}
          className="mx-7 justify-start text-xs text-warn"
        >
          {t("codes.problem")}
        </Button>
      ) : null}
      {!sorting && quota !== null ? (
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
      {sorting && list ? (
        <Suspense fallback={null}>
          <SortList
            accounts={accounts}
            siteIds={new Set(siteRows.map((a) => a.id))}
            groups={list.groups}
            onMove={moveInSort}
            onSwap={swapInSort}
            onDone={() => {
              setSorting(false);
              sortToggle.current?.focus();
            }}
          />
        </Suspense>
      ) : null}
      {sorting ? null : (
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
                    state.snapshotOffer.accountCount === 1
                      ? "snapshots.offerOne"
                      : "snapshots.offer",
                    { count: state.snapshotOffer.accountCount },
                  )}
                </Button>
              ) : null}
              <Button variant="primary" onClick={() => setAdding(true)}>
                {t("codes.add")}
              </Button>
            </div>
          ) : null}
          {filtered && filtered.length === 0 ? (
            <div className="flex flex-col items-start gap-2 pt-10">
              <p role="status" className="m-0 text-sm text-muted">
                {t("codes.noResults")}
              </p>
              <Button variant="link" onClick={() => setAdding(true)} className="text-[13px]">
                {t("codes.add")}
              </Button>
            </div>
          ) : filtered ? (
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
      )}
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
