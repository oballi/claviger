import { useCallback, useEffect, useRef, useState } from "react";
import type { TrashItemView } from "../contract/views";
import { TRASH_RETENTION_DAYS } from "../contract/views";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { errorMessage } from "../errors";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { LOW_DAYS, trashName } from "../trash";
import { deletedLabel } from "./trashLabels";

type Confirm = { kind: "one"; item: TrashItemView } | { kind: "all" };

/** Design board "Yönetim — son silinenler". Codes and secrets are never shown here. */
export function TrashSection({
  version,
  onMessage,
  hideWhenEmpty = false,
}: {
  version: number;
  onMessage: (text: string) => void;
  /** Render nothing while the bin is loading or empty (first-run welcome). */
  hideWhenEmpty?: boolean;
}) {
  const { rpc } = useUi();
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<TrashItemView[] | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // Row index to refocus once the list has re-rendered after an action took the focused button away.
  const refocus = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await rpc("listTrash", {}));
      setError(null);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [rpc, t]);

  useEffect(() => {
    void load();
  }, [load, version]);

  // The popup or another tab may have changed the bin while this page was in the background.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  useEffect(() => {
    if (refocus.current === null || !items) return;
    const buttons = root.current?.querySelectorAll<HTMLElement>("[data-restore]") ?? [];
    const target = buttons[Math.min(refocus.current, buttons.length - 1)] ?? heading.current;
    refocus.current = null;
    target?.focus();
  }, [items]);

  async function run(action: () => Promise<unknown>, text: string, row: number) {
    setError(null);
    setConfirm(null);
    try {
      await action();
      refocus.current = row;
      onMessage(text);
    } catch (e) {
      setError(errorMessage(t, e));
      void load();
    }
  }

  const list = items ?? [];
  const nameOf = (item: TrashItemView) => trashName(item, t);
  if (hideWhenEmpty && !error && list.length === 0) return null;

  return (
    <section
      ref={root}
      aria-label={t("trash.manageTitle")}
      className="flex max-w-[760px] flex-col gap-1.5"
    >
      <h2 ref={heading} tabIndex={-1} className="m-0 text-xl font-medium outline-none">
        {t("trash.manageTitle")}{" "}
        <span className="font-mono text-[13px] font-normal text-muted">
          {items ? list.length : ""}
        </span>
      </h2>
      <p className="m-0 pb-4 text-[13px] leading-normal text-muted">
        {t("trash.manageNote", { days: TRASH_RETENTION_DAYS })}
      </p>
      {error ? (
        <p role="alert" className="m-0 pb-3 text-[13px] text-warn">
          {error}
        </p>
      ) : null}
      {items && list.length === 0 ? (
        <p className="m-0 border-t border-hair py-4 text-[13px] text-muted">{t("trash.empty")}</p>
      ) : null}
      {list.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">{t("trash.manageTitle")}</caption>
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th scope="col" className="pb-2.5 font-normal">
                  {t("add.issuer")}
                </th>
                <th scope="col" className="pb-2.5 font-normal">
                  {t("add.label")}
                </th>
                <th scope="col" className="pb-2.5 font-normal">
                  {t("trash.col.deleted")}
                </th>
                <th scope="col" className="pb-2.5 font-normal">
                  {t("trash.col.left")}
                </th>
                <th scope="col" className="pb-2.5 font-normal">
                  <span className="sr-only">{t("accounts.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((item, index) => (
                <tr key={item.id} className="h-[60px] border-b border-hair">
                  <td className="max-w-[200px] truncate pr-4">{nameOf(item)}</td>
                  <td className="max-w-[200px] truncate pr-4 text-muted">
                    {item.issuer ? item.label : ""}
                  </td>
                  <td className="pr-4 text-muted">{deletedLabel(locale, t, item)}</td>
                  <td
                    className={`pr-4 font-mono text-xs ${item.daysLeft <= LOW_DAYS ? "text-warn" : ""}`}
                  >
                    {t(item.daysLeft === 1 ? "trash.daysOne" : "trash.days", {
                      count: item.daysLeft,
                    })}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Button
                      data-restore=""
                      aria-label={t("trash.restoreRow", { name: nameOf(item) })}
                      onClick={() =>
                        void run(
                          () => rpc("restoreTrash", { id: item.id }),
                          t("trash.restored", { name: nameOf(item) }) + ".",
                          index,
                        )
                      }
                    >
                      {t("trash.restore")}
                    </Button>{" "}
                    <Button
                      variant="danger"
                      className="ml-2"
                      aria-label={t("trash.purgeRow", { name: nameOf(item) })}
                      onClick={() => setConfirm({ kind: "one", item })}
                    >
                      {t("trash.purge")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {list.length > 0 ? (
        <div className="flex justify-end pt-3">
          <Button variant="link" className="text-muted" onClick={() => setConfirm({ kind: "all" })}>
            {t("trash.purgeAll")}
          </Button>
        </div>
      ) : null}

      {confirm ? (
        <Dialog title={t("trash.purgeTitle")} onClose={() => setConfirm(null)}>
          <div className="flex flex-col gap-5">
            <p className="m-0 text-sm leading-relaxed">
              {confirm.kind === "one"
                ? t("trash.purgeConfirm", { name: nameOf(confirm.item) })
                : t("trash.purgeAllConfirm", { count: list.length })}
            </p>
            <div className="flex gap-2">
              <Button onClick={() => setConfirm(null)}>{t("common.cancel")}</Button>
              <Button
                variant="danger"
                onClick={() =>
                  confirm.kind === "one"
                    ? void run(
                        () => rpc("purgeTrash", { id: confirm.item.id }),
                        t("trash.purged", { name: nameOf(confirm.item) }),
                        list.indexOf(confirm.item),
                      )
                    : void run(() => rpc("emptyTrash", {}), t("trash.purgedAll"), 0)
                }
              >
                {t("trash.purgeYes")}
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
