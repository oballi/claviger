import type { MouseEvent } from "react";
import type { AccountView, ViewMode } from "../contract/views";
import { Button } from "../components/Button";
import { CountdownRing } from "../components/CountdownRing";
import { Icon } from "../components/Icon";
import { formatCode, maskCode } from "../format";
import { useT } from "../i18n/i18n";
import { RowMenu, type MenuItem } from "./RowMenu";

export function AccountRow({
  account,
  large = false,
  pinnedMark = false,
  menu,
  confirmDelete,
  mode,
  onCopy,
  onNextHotp,
}: {
  account: AccountView;
  /** "This site" rows use the large code layout from the design. */
  large?: boolean;
  /** Shown in the grouped layout, where pinned rows are not in their own section. */
  pinnedMark?: boolean;
  menu?: MenuItem[];
  /** Inline delete confirmation shown under the row. */
  confirmDelete?: { onConfirm: () => void; onCancel: () => void };
  mode: ViewMode;
  onCopy: (account: AccountView) => void;
  onNextHotp: (account: AccountView) => void;
}) {
  const t = useT();
  const name = account.issuer || account.label;
  const hidden = mode === "hidden";
  const compact = mode === "compact";
  const code = hidden ? maskCode(account.digits) : formatCode(account.code);
  // Convenience only: the code button stays the keyboard/screen-reader control, so the row has no role.
  const copyFromRow = (e: MouseEvent<HTMLLIElement>) => {
    if (window.getSelection()?.toString()) return;
    if (
      (e.target as Element).closest("button, a, input, select, textarea, [role=alert], [role=menu]")
    )
      return;
    onCopy(account);
  };
  const menuButton = menu ? (
    <RowMenu label={t("menu.actions", { issuer: name })} items={menu} triggerId={account.id} />
  ) : null;
  const deleteConfirm = confirmDelete ? (
    <div
      className="basis-full pb-3"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        confirmDelete.onCancel();
      }}
    >
      <p role="alert" className="m-0 pb-3 text-[13px] leading-normal text-warn">
        {t("codes.deleteConfirm")}
      </p>
      <div className="flex gap-2">
        <Button variant="danger" autoFocus onClick={confirmDelete.onConfirm}>
          {t("menu.deleteYes")}
        </Button>
        <Button onClick={confirmDelete.onCancel}>{t("common.cancel")}</Button>
      </div>
    </div>
  ) : null;
  const urgent = account.remaining !== null && account.remaining <= 5;
  const critical = account.remaining !== null && account.remaining <= 1;
  const copyButton = (
    <button
      type="button"
      data-code-button=""
      aria-label={
        hidden ? t("codes.copyHidden", { issuer: name }) : t("codes.copy", { issuer: name, code })
      }
      onClick={() => onCopy(account)}
      className={`shrink-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono tracking-wide ${large ? (compact ? "min-h-11 text-2xl leading-tight" : "min-h-11 text-[34px] leading-tight") : compact ? "min-h-11 text-base" : "min-h-11 text-xl"} ${critical ? "text-critical" : urgent ? "text-warn" : "text-text"}`}
    >
      {code}
    </button>
  );
  const tail =
    account.type === "hotp" ? (
      <button
        type="button"
        aria-label={t("codes.next", { issuer: name })}
        onClick={() => onNextHotp(account)}
        className="-m-[13px] flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted"
      >
        <Icon name="refresh" />
      </button>
    ) : (
      <CountdownRing
        remaining={account.remaining ?? 0}
        period={account.period}
        size={large ? 20 : 18}
      />
    );

  if (large) {
    return (
      <li
        onClick={copyFromRow}
        className="ov-row -mx-3 flex cursor-pointer flex-col gap-1 rounded-xl px-3 pt-3 pb-5"
      >
        <div className="truncate text-[13px]">{name}</div>
        <div className="flex items-end justify-between gap-4">
          {copyButton}
          <div className="flex items-center gap-1 pb-3">
            {tail}
            {menuButton}
          </div>
        </div>
        {deleteConfirm}
      </li>
    );
  }
  const showLabel = !compact && Boolean(account.issuer && account.label);
  return (
    <li
      onClick={copyFromRow}
      title={
        account.issuer && account.label ? `${account.issuer}: ${account.label}` : name || undefined
      }
      className="ov-row -mx-3 flex cursor-pointer flex-wrap items-center gap-x-3 rounded-xl px-3 pt-2 pb-1"
    >
      <div className="flex w-full items-center gap-3">
        <div data-row-name="" className="min-w-0 flex-1 truncate text-[13px]">
          {name}
          {pinnedMark && account.pinned ? (
            <span className="text-muted"> · {t("codes.pinnedMark")}</span>
          ) : null}
        </div>
        {copyButton}
        {tail}
        {menuButton}
      </div>
      {showLabel ? (
        // Pulled into the code button's empty min-h-11 padding so the row keeps its old height;
        // pointer-events-none keeps it from covering the bottom of the code and menu buttons.
        <div
          data-row-label=""
          className="pointer-events-none -mt-3.5 w-full basis-full truncate text-xs text-muted"
        >
          {account.label}
        </div>
      ) : null}
      {deleteConfirm}
    </li>
  );
}
