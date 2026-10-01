import { useState } from "react";
import type { AccountView, ServiceState } from "../../background/vaultService";
import { AccountForm } from "../components/AccountForm";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import { errorMessage } from "../errors";
import { formatDate, lockPolicyLabel } from "../format";
import { useAccountList } from "../hooks";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { AccountEditor } from "./AccountEditor";
import { PageTitle } from "./ManageFrame";

/** Design board "Yönetim — hesaplar". */
export function AccountsScreen({
  state,
  onChanged,
}: {
  state: ServiceState;
  onChanged: () => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const locale = useLocale();
  const { list, error, reload } = useAccountList(undefined, 0);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [maintenanceError, setMaintenanceError] = useState<string | null>(null);

  const accounts = list?.accounts ?? [];
  const q = query.trim().toLocaleLowerCase(locale);
  const rows = q
    ? accounts.filter((a) =>
        `${a.issuer} ${a.label} ${a.domains.join(" ")}`.toLocaleLowerCase(locale).includes(q),
      )
    : accounts;
  const selected = accounts.find((a) => a.id === editing);

  function changed(text: string) {
    setMessage(text);
    void reload();
    onChanged();
  }

  // Reordering swaps with the neighbour in the same group, so pinned and other accounts never mix.
  function neighbours(account: AccountView) {
    const group = accounts.filter((a) => a.pinned === account.pinned);
    const index = group.findIndex((a) => a.id === account.id);
    return { up: group[index - 1], down: group[index + 1] };
  }

  async function move(account: AccountView, delta: -1 | 1) {
    const other = delta === -1 ? neighbours(account).up : neighbours(account).down;
    if (!other) return;
    const order = accounts.map((a) => a.id);
    const i = order.indexOf(account.id);
    const j = order.indexOf(other.id);
    [order[i], order[j]] = [order[j]!, order[i]!];
    await rpc("reorder", { order });
  }

  async function maintenance(action: () => Promise<unknown>, text: string) {
    setMaintenanceError(null);
    setConfirmDelete(null);
    try {
      await action();
      changed(text);
    } catch (e) {
      setMaintenanceError(errorMessage(t, e));
    }
  }

  return (
    <div className="flex flex-col gap-12">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <PageTitle title={t("accounts.title")} count={accounts.length} />
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-11 w-[260px] items-center gap-2.5 border-b border-line">
            <Icon name="search" size={15} className="text-muted" />
            <input
              type="search"
              aria-label={t("codes.search")}
              placeholder={t("accounts.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-text outline-none"
            />
          </div>
          <Button variant="primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={15} />
            {t("codes.add")}
          </Button>
        </div>
      </div>

      <p role="status" className="m-0 -my-6 min-h-4 text-sm">
        {message}
      </p>

      {error ? (
        <p role="alert" className="m-0 text-sm text-warn">
          {errorMessage(t, error)}
        </p>
      ) : null}

      {list && (list.unreadable.length > 0 || list.indexDamaged) ? (
        <section
          aria-label={t("accounts.maintenance")}
          className="flex flex-col gap-4 border-y border-warn py-5"
        >
          <h2 className="m-0 text-[15px] font-medium text-warn">{t("accounts.maintenance")}</h2>
          {list.indexDamaged ? (
            <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
              <span>{t("accounts.indexDamaged")}</span>
              <Button
                onClick={() =>
                  void maintenance(() => rpc("rebuildIndex", {}), t("accounts.rebuilt"))
                }
              >
                {t("accounts.rebuild")}
              </Button>
            </div>
          ) : null}
          {list.unreadable.length > 0 ? (
            <>
              <p className="m-0 text-sm">{t("accounts.unreadable")}</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {list.unreadable.map((id) => (
                  <li
                    key={id}
                    className="flex flex-wrap items-center justify-between gap-3 text-sm"
                  >
                    <code className="font-mono text-xs">{id}</code>
                    {confirmDelete === id ? (
                      <span className="flex items-center gap-2">
                        <span>{t("accounts.unreadableConfirm")}</span>
                        <Button onClick={() => setConfirmDelete(null)}>{t("common.cancel")}</Button>
                        <Button
                          variant="danger"
                          onClick={() =>
                            void maintenance(
                              () => rpc("deleteAccount", { id }),
                              t("accounts.unreadableDeleted"),
                            )
                          }
                        >
                          {t("account.deleteYes")}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="danger"
                        aria-label={t("accounts.unreadableDelete", { id })}
                        onClick={() => setConfirmDelete(id)}
                      >
                        {t("account.delete")}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {maintenanceError ? (
            <p role="alert" className="m-0 text-sm text-warn">
              {maintenanceError}
            </p>
          ) : null}
        </section>
      ) : null}

      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{t("accounts.title")}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="pb-2.5 font-normal">
              {t("add.issuer")}
            </th>
            <th scope="col" className="pb-2.5 font-normal">
              {t("add.label")}
            </th>
            <th scope="col" className="pb-2.5 font-normal">
              {t("accounts.site")}
            </th>
            <th scope="col" className="pb-2.5 font-normal">
              {t("add.type")}
            </th>
            <th scope="col" className="pb-2.5 font-normal">
              <span className="sr-only">{t("accounts.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list && rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-muted">
                {q ? t("accounts.noMatch") : t("codes.empty")}
              </td>
            </tr>
          ) : null}
          {rows.map((a) => {
            const name = a.issuer || a.label;
            return (
              <tr key={a.id} className="h-14 border-b border-hair">
                <td className="pr-4">
                  <span className="flex items-center gap-2.5">
                    {name}
                    {a.pinned ? (
                      <span className="rounded-full border border-line px-[7px] py-px font-mono text-[10px] text-muted">
                        {t("accounts.pinnedBadge")}
                      </span>
                    ) : null}
                  </span>
                </td>
                <td className="max-w-[240px] truncate pr-4 text-muted">
                  {a.issuer ? a.label : ""}
                </td>
                <td
                  className={`max-w-[240px] truncate pr-4 font-mono text-xs ${a.domains.length ? "" : "text-muted"}`}
                >
                  {a.domains.length ? a.domains.join(", ") : t("accounts.unbound")}
                </td>
                <td className="pr-4 font-mono text-xs text-muted">{a.type.toUpperCase()}</td>
                <td className="text-right">
                  <Button
                    variant="link"
                    aria-label={t("accounts.edit", { name })}
                    onClick={() => setEditing(a.id)}
                  >
                    {t("account.edit")}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <dl className="m-0 grid grid-cols-1 border-y border-hair sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 py-5 pr-6">
          <dt className="text-xs text-muted">{t("accounts.summary.lock")}</dt>
          <dd className="m-0 text-sm">{lockPolicyLabel(t, state.lockPolicy)}</dd>
        </div>
        <div className="flex flex-col gap-1.5 border-hair py-5 sm:border-l sm:px-6">
          <dt className="text-xs text-muted">{t("accounts.summary.storage")}</dt>
          <dd className="m-0 text-sm">
            {state.storageArea === "sync" ? t("storage.sync") : t("storage.local")}
          </dd>
        </div>
        <div className="flex flex-col gap-1.5 border-hair py-5 sm:border-l sm:px-6">
          <dt className="text-xs text-muted">{t("accounts.summary.backup")}</dt>
          <dd className={`m-0 text-sm ${state.lastBackupAt === null ? "text-warn" : ""}`}>
            {state.lastBackupAt === null
              ? t("backup.never")
              : formatDate(locale, state.lastBackupAt)}
          </dd>
        </div>
      </dl>

      {adding ? (
        <Dialog title={t("add.title")} onClose={() => setAdding(false)}>
          <AccountForm
            onAdded={(name) => {
              setAdding(false);
              changed(t("codes.added", { issuer: name }));
            }}
          />
        </Dialog>
      ) : null}

      {selected ? (
        <AccountEditor
          key={selected.id}
          account={selected}
          revealRequiresPassword={state.revealRequiresPassword}
          canMove={{
            up: Boolean(neighbours(selected).up),
            down: Boolean(neighbours(selected).down),
          }}
          onMove={(delta) => move(selected, delta)}
          onClose={() => setEditing(null)}
          onChanged={(text) => {
            setEditing(null);
            changed(text);
          }}
        />
      ) : null}
    </div>
  );
}
