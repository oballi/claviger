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
  const showLabel = !large && !compact && Boolean(account.issuer && account.label);
  // With a label line the 44px hit areas hang down from the row top (not centred), so they never
  // reach into the previous row; the label line is pointer-events-none underneath them.
  const hitDown = "h-11 -mt-[7px] self-start pb-2.5";
  const menuButton = menu ? (
    <RowMenu
      label={t("menu.actions", { issuer: name })}
      items={menu}
      triggerId={account.id}
      hitClass={showLabel ? hitDown : undefined}
    />
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
      className={`shrink-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono tracking-wide ${large ? (compact ? "min-h-11 text-2xl leading-tight" : "min-h-11 text-[34px] leading-tight") : `${showLabel ? hitDown : "min-h-11"} ${compact ? "text-base" : "text-xl"}`} ${critical ? "text-critical" : urgent ? "text-warn" : "text-text"}`}
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
        className={`${showLabel ? `-mx-[13px] w-11 ${hitDown}` : "-m-[13px] h-11 w-11"} flex shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted`}
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
  return (
    <li
      onClick={copyFromRow}
      title={
        account.issuer && account.label ? `${account.issuer}: ${account.label}` : name || undefined
      }
      className={`ov-row -mx-3 flex cursor-pointer flex-col rounded-xl px-3 ${showLabel ? "pt-[7px] pb-[7px]" : "min-h-11 justify-center"}`}
    >
      {/* Fixed-height line: the 44px buttons are taller than it and overflow it evenly (hit areas only). */}
      <div className="relative z-10 flex h-5 items-center gap-3">
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
        // pointer-events-none: the buttons' overflowing hit areas reach into this line.
        <div
          data-row-label=""
          className="pointer-events-none mt-0.5 truncate text-xs leading-4 text-muted"
        >
          {account.label}
        </div>
      ) : null}
      {deleteConfirm}
    </li>
  );
}
