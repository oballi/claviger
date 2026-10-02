import { useState } from "react";
import type { AccountView, DuplicateGroupView } from "../contract/views";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

const nameOf = (a: AccountView) => a?.issuer || a?.label || "";

/** Design language of the manage page; accounts show name, group and sites, never a code. */
export function DuplicatesDialog({
  groups,
  accounts,
  groupName,
  onClose,
  onMerged,
  onEdit,
}: {
  groups: DuplicateGroupView[];
  accounts: AccountView[];
  groupName: (a: AccountView) => string | undefined;
  onClose: () => void;
  onMerged: (result: { removed: string[]; undoId: string }) => void;
  onEdit: (id: string) => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function merge(group: DuplicateGroupView, keepId: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await rpc("mergeAccounts", {
        keepId,
        removeIds: group.ids.filter((id) => id !== keepId),
      });
      onMerged(result);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  const summary = (a: AccountView, lower = false) => (
    <span className="min-w-0 flex-1">
      <span className="block truncate">{nameOf(a) || t("add.unnamed")}</span>
      <span className="block truncate text-xs text-muted">
        {[a.issuer ? a.label : "", groupName(a), a.domains.join(", ")]
          .filter(Boolean)
          .join(" \u00b7 ")}
      </span>
      {lower ? <span className="block text-xs text-warn">{t("dupes.lowerCounter")}</span> : null}
    </span>
  );
  const fullName = (a: AccountView) =>
    a.issuer && a.label ? `${a.issuer} (${a.label})` : nameOf(a) || t("add.unnamed");
  const listClass = "m-0 flex list-none flex-col divide-y divide-hair p-0";
  const rowClass = "flex items-center gap-4 py-2.5 text-sm";

  return (
    <Dialog title={t("dupes.title")} onClose={onClose}>
      <div className="flex max-h-[70vh] flex-col gap-8 overflow-auto">
        {groups.map((group, index) => {
          if (group.kind === "exact") {
            const keepId = picked[index] ?? group.keepId ?? group.ids[0]!;
            return (
              <section key={index} className="flex flex-col gap-2">
                <h3 className="m-0 text-[15px] font-medium">{t("dupes.exact")}</h3>
                <p className="m-0 text-xs text-muted">{t("dupes.exactNote")}</p>
                <ul className={listClass}>
                  {group.ids.map((id) => {
                    const a = byId.get(id);
                    if (!a) return null;
                    const lower = group.ineligible.includes(id);
                    return (
                      <li key={id} className={rowClass}>
                        <input
                          type="radio"
                          name={`keep-${index}`}
                          value={id}
                          checked={keepId === id}
                          disabled={lower}
                          aria-label={t("dupes.keepAria", { name: fullName(a) })}
                          onChange={() => setPicked((p) => ({ ...p, [index]: id }))}
                          className="size-4 accent-[var(--color-btn)]"
                        />
                        {summary(a, lower)}
                      </li>
                    );
                  })}
                </ul>
                <div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void merge(group, keepId)}
                  >
                    {t("dupes.merge")}
                  </Button>
                </div>
              </section>
            );
          }
          if (group.kind === "same-secret")
            return (
              <section key={index} className="flex flex-col gap-2">
                <p className="m-0 text-xs text-muted">{t("dupes.sameSecret")}</p>
                <ul className={listClass}>
                  {group.ids.map((id) => {
                    const a = byId.get(id);
                    return a ? (
                      <li key={id} className={rowClass}>
                        {summary(a)}
                      </li>
                    ) : null;
                  })}
                </ul>
              </section>
            );
          return (
            <section key={index} className="flex flex-col gap-2">
              <h3 className="m-0 text-[15px] font-medium">{t("dupes.similar")}</h3>
              <p className="m-0 text-xs text-muted">{t("dupes.similarNote")}</p>
              <ul className={listClass}>
                {group.ids.map((id) => {
                  const a = byId.get(id);
                  if (!a) return null;
                  return (
                    <li key={id} className={rowClass}>
                      {summary(a)}
                      <Button
                        variant="link"
                        aria-label={t("dupes.editAria", { name: fullName(a) })}
                        onClick={() => onEdit(id)}
                      >
                        {t("dupes.edit")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
        {error ? (
          <p role="alert" className="m-0 text-sm text-warn">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
