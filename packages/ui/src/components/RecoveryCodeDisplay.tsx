import { useState } from "react";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { Notice } from "./Notice";

/** Shows a one-time recovery code; the done button stays disabled until the user confirms saving it. */
export function RecoveryCodeDisplay({
  code,
  doneLabel,
  onDone,
}: {
  code: string;
  doneLabel: string;
  onDone: () => void;
}) {
  const { copy, download, print } = useUi();
  const t = useT();
  const [saved, setSaved] = useState(false);
  const groups = code.split("-");
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <div
          data-print=""
          data-testid="recovery-code"
          aria-label={t("recovery.label")}
          role="group"
          className="grid grid-cols-2 gap-x-8 gap-y-3 border-y border-hair py-5 sm:grid-cols-4"
        >
          {groups.map((group, i) => (
            <span key={i} className="flex items-baseline gap-3">
              <span className="font-mono text-[11px] text-muted" aria-hidden="true">
                {i + 1}
              </span>
              <span className="font-mono text-lg tracking-widest">{group}</span>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void copy(code)}>
            <Icon name="copy" size={14} />
            {t("common.copy")}
          </Button>
          <Button
            onClick={() => download(t("recovery.filename"), t("recovery.fileText", { code }))}
          >
            <Icon name="download" size={14} />
            {t("recovery.download")}
          </Button>
          <Button onClick={print}>
            <Icon name="print" size={14} />
            {t("recovery.print")}
          </Button>
        </div>
      </div>
      <Notice label={t("recovery.onceLabel")}>{t("recovery.once")}</Notice>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
        <input
          type="checkbox"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="h-4 w-4 accent-[var(--ov-text)]"
        />
        {t("recovery.saved")}
      </label>
      <div>
        <Button variant="primary" disabled={!saved} onClick={onDone}>
          {doneLabel}
        </Button>
      </div>
    </div>
  );
}
