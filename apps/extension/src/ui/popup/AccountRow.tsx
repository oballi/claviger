import type { ViewMode } from "../../background/settings";
import type { AccountView } from "../../background/vaultService";
import { CountdownRing } from "../components/CountdownRing";
import { Icon } from "../components/Icon";
import { formatCode, maskCode } from "../format";
import { useT } from "../i18n/i18n";

export function AccountRow({
  account,
  large = false,
  suggested = false,
  mode,
  onCopy,
  onNextHotp,
}: {
  account: AccountView;
  /** "This site" rows use the large code layout from the design. */
  large?: boolean;
  suggested?: boolean;
  mode: ViewMode;
  onCopy: (account: AccountView) => void;
  onNextHotp: (account: AccountView) => void;
}) {
  const t = useT();
  const name = account.issuer || account.label;
  const hidden = mode === "hidden";
  const compact = mode === "compact";
  const code = hidden ? maskCode(account.digits) : formatCode(account.code);
  const urgent = account.remaining !== null && account.remaining <= 5;
  const copyButton = (
    <button
      type="button"
      data-code-button=""
      aria-label={
        hidden ? t("codes.copyHidden", { issuer: name }) : t("codes.copy", { issuer: name, code })
      }
      onClick={() => onCopy(account)}
      className={`cursor-pointer border-0 bg-transparent p-0 text-left font-mono tracking-wide ${large ? (compact ? "min-h-11 text-2xl leading-tight" : "min-h-11 text-[34px] leading-tight") : compact ? "min-h-11 text-base" : "min-h-11 text-xl"} ${urgent ? "text-warn" : "text-text"}`}
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
      <li className="flex items-end gap-4 border-b border-hair pb-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="truncate text-[13px]">
            {name}
            {suggested ? <span className="text-muted"> · {t("codes.suggested")}</span> : null}
          </div>
          {copyButton}
        </div>
        <div className="flex items-center gap-3 pb-3">{tail}</div>
      </li>
    );
  }
  return (
    <li className="flex items-center gap-3 border-b border-hair py-1">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{name}</div>
        {!compact && account.issuer && account.label ? (
          <div className="truncate text-xs text-muted">{account.label}</div>
        ) : null}
      </div>
      {copyButton}
      {tail}
    </li>
  );
}
