import type { MouseEvent } from "react";
import type { AccountView, ViewMode } from "../contract/views";
import { Button } from "../components/Button";
import { CountdownRing } from "../components/CountdownRing";
import { Icon } from "../components/Icon";
import { formatCode, maskCode } from "../format";
import { useT } from "../i18n/i18n";

export type FillPrompt = "confirm" | "blocked" | "link";

export interface FillControls {
  prompt: FillPrompt | null;
  busy: boolean;
  /** Registrable domain of the page; the same value is sent as confirmedDomain. */
  domain: string | null;
  onFill: (account: AccountView) => void;
  onConfirm: (account: AccountView) => void;
  onCancel: () => void;
  onLink: (account: AccountView) => void;
  onOpenSecurity: () => void;
}

export function AccountRow({
  account,
  large = false,
  suggested = false,
  remembered = false,
  pinnedMark = false,
  fill,
  mode,
  onCopy,
  onNextHotp,
}: {
  account: AccountView;
  /** "This site" rows use the large code layout from the design. */
  large?: boolean;
  suggested?: boolean;
  remembered?: boolean;
  /** Shown in the grouped layout, where pinned rows are not in their own section. */
  pinnedMark?: boolean;
  /** Present only on "This site" rows of a popup that knows its tab. */
  fill?: FillControls;
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
      (e.target as Element).closest(
        "button, a, input, select, textarea, [role=group], [role=alert]",
      )
    )
      return;
    onCopy(account);
  };
  const urgent = account.remaining !== null && account.remaining <= 5;
  const copyButton = (
    <button
      type="button"
      data-code-button=""
      aria-label={
        hidden ? t("codes.copyHidden", { issuer: name }) : t("codes.copy", { issuer: name, code })
      }
      onClick={() => onCopy(account)}
      className={`shrink-0 cursor-pointer whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono tracking-wide ${large ? (compact ? "min-h-11 text-2xl leading-tight" : "min-h-11 text-[34px] leading-tight") : compact ? "min-h-11 text-base" : "min-h-11 text-xl"} ${urgent ? "text-warn" : "text-text"}`}
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
        className="ov-row -mx-3 flex cursor-pointer flex-col gap-1 rounded-xl px-3 pb-5"
      >
        <div className="truncate text-[13px]">
          {name}
          {suggested ? <span className="text-muted"> · {t("codes.suggested")}</span> : null}
          {remembered && !suggested ? (
            <span className="text-muted"> · {t("codes.remembered")}</span>
          ) : null}
        </div>
        <div className="flex items-end justify-between gap-4">
          {copyButton}
          <div className="pb-3">{tail}</div>
        </div>
        {fill ? (
          <div>
            <Button
              className="border-text"
              disabled={fill.busy}
              aria-label={t("fill.aria", { issuer: name })}
              onClick={() => fill.onFill(account)}
            >
              {t("fill.button")}
            </Button>
          </div>
        ) : null}
        {fill?.prompt === "confirm" ? (
          <div role="group" className="pt-3">
            <p className="m-0 pb-2 text-xs text-warn">
              {t("fill.confirm", { issuer: name, domain: fill.domain ?? "" })}
            </p>
            <div className="flex gap-2">
              <Button variant="primary" autoFocus onClick={() => fill.onConfirm(account)}>
                {t("fill.confirmYes")}
              </Button>
              <Button onClick={fill.onCancel}>{t("fill.confirmNo")}</Button>
            </div>
          </div>
        ) : null}
        {fill?.prompt === "blocked" ? (
          <div className="pt-3">
            <p role="alert" className="m-0 text-xs text-warn">
              {t("fill.blocked")}
            </p>
            <Button variant="link" onClick={fill.onOpenSecurity} className="text-xs">
              {t("fill.linkBlocked")}
            </Button>
          </div>
        ) : null}
        {fill?.prompt === "link" ? (
          <div className="flex items-center gap-4 pt-1">
            <Button variant="link" onClick={() => fill.onLink(account)} className="text-xs">
              {t("fill.link")}
            </Button>
            <Button variant="link" onClick={fill.onCancel} className="text-xs text-muted">
              {t("common.close")}
            </Button>
          </div>
        ) : null}
      </li>
    );
  }
  return (
    <li
      onClick={copyFromRow}
      className="ov-row -mx-3 flex cursor-pointer items-center gap-3 rounded-xl px-3 py-1"
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">
          {name}
          {pinnedMark && account.pinned ? (
            <span className="text-muted"> · {t("codes.pinnedMark")}</span>
          ) : null}
        </div>
        {!compact && account.issuer && account.label ? (
          <div className="truncate text-xs text-muted">{account.label}</div>
        ) : null}
      </div>
      {copyButton}
      {tail}
    </li>
  );
}
