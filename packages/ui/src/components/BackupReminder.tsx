import { useState } from "react";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";

/** Polite notice (not an alert); popup keys only, so it can ship in the popup bundle. */
export function BackupReminder({
  daysSince,
  className = "",
}: {
  daysSince: number | null;
  className?: string;
}) {
  const { rpc, openManage } = useUi();
  const t = useT();
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <div
      role="status"
      aria-label={t("backupNotice.title")}
      className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] leading-normal ${className}`}
    >
      <span className="min-w-[16rem] flex-1 text-muted">
        {daysSince === null
          ? t("backupNotice.never")
          : t("backupNotice.since", { days: daysSince })}
      </span>
      <Button variant="link" onClick={() => openManage("backup")}>
        {t("backupNotice.action")}
      </Button>
      <Button
        variant="link"
        aria-label={t("backupNotice.dismissLabel")}
        className="text-muted"
        onClick={() => {
          setHidden(true);
          void rpc("dismissBackupReminder", {}).catch(() => {});
        }}
      >
        {t("backupNotice.dismiss")}
      </Button>
    </div>
  );
}
