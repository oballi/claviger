import { useEffect, useRef, useState } from "react";
import type { TrashItemView } from "../contract/views";
import { TRASH_RETENTION_DAYS } from "../contract/views";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { useT } from "../i18n/i18n";
import { popupMeta, trashName } from "../trash";

export function TrashList({
  items,
  error,
  onBack,
  onRestore,
}: {
  items: TrashItemView[];
  error: string | null;
  onBack: () => void;
  onRestore: (item: TrashItemView) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);

  // A restored row takes its focused button with it; keep focus inside the view.
  useEffect(() => {
    if (document.activeElement && document.activeElement !== document.body) return;
    (root.current?.querySelector<HTMLElement>("[data-restore]") ?? backButton.current)?.focus();
  }, [items.length, busy]);

  async function restore(item: TrashItemView) {
    // aria-disabled keeps focus on the button, so the guard lives here.
    if (busy) return;
    setBusy(item.id);
    try {
      await onRestore(item);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={root}
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onBack();
      }}
    >
      <header className="flex items-center pt-2 pr-7 pl-4">
        <button
          ref={backButton}
          type="button"
          aria-label={t("common.back")}
          onClick={onBack}
          className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text hover:bg-hair"
        >
          <Icon name="back" size={18} />
        </button>
        <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-7 pb-6">
        <h1 className="m-0 pt-4 pb-1.5 text-2xl font-medium tracking-tight">{t("trash.title")}</h1>
        <p className="m-0 pb-5 text-xs leading-normal text-muted">
          {t("trash.popupNote", { days: TRASH_RETENTION_DAYS })}
        </p>
        {error ? (
          <p role="alert" className="m-0 pb-3 text-xs text-warn">
            {error}
          </p>
        ) : null}
        <ul aria-label={t("trash.listLabel")} className="m-0 list-none p-0">
          {items.map((item) => {
            const name = trashName(item, t);
            return (
              <li
                key={item.id}
                className="flex min-h-[60px] items-center gap-2.5 border-b border-hair"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px]">{name}</div>
                  <div className="truncate text-xs text-muted">{popupMeta(t, item)}</div>
                </div>
                <Button
                  data-restore=""
                  aria-disabled={busy !== null}
                  aria-label={t("trash.restoreRow", { name })}
                  onClick={() => void restore(item)}
                  className="shrink-0 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
                >
                  {t("trash.restore")}
                </Button>
              </li>
            );
          })}
        </ul>
        <div className="flex-1" />
        <p className="m-0 pt-4 text-xs leading-normal text-muted">{t("trash.popupFoot")}</p>
      </div>
    </div>
  );
}
