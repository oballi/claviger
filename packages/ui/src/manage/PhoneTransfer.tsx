import { useEffect, useRef, useState } from "react";
import { Button } from "../components/Button";
import { QrCode } from "../components/QrCode";
import { ReauthForm } from "../components/ReauthForm";
import { useAutoHide } from "../components/useAutoHide";
import type { AccountView } from "../contract/views";
import { useT, type MessageKey } from "../i18n/i18n";
import { useUi } from "../platform";

const AUTO_HIDE_MS = 120_000;
const REASONS: Record<string, MessageKey> = {
  "digits-unsupported": "transfer.reason.digits",
  "period-unsupported": "transfer.reason.period",
  "type-unsupported": "transfer.reason.type",
  "too-long": "transfer.reason.tooLong",
};

interface Shown {
  uris: string[];
  skipped: { name: string; reason: string }[];
}

/** Google Authenticator migration QRs: pick accounts, re-authenticate, page through the codes. Not a backup. */
export function PhoneTransfer({ onClose }: { onClose: () => void }) {
  const { rpc } = useUi();
  const t = useT();
  const [accounts, setAccounts] = useState<AccountView[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Shown | null>(null);
  const [page, setPage] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    rpc("listAccounts", {}).then(
      (list) => {
        if (!live) return;
        setAccounts(list.accounts);
        setSelected(new Set(list.accounts.map((a) => a.id)));
      },
      () => live && setLoadFailed(true),
    );
    return () => {
      live = false;
    };
  }, [rpc]);

  const { secondsLeft } = useAutoHide(shown !== null, AUTO_HIDE_MS, () => {
    setShown(null);
    onClose();
  });

  function toggle(id: string) {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  }

  if (shown) {
    const total = shown.uris.length;
    return (
      <div ref={root} className="flex flex-col items-start gap-5 py-5">
        {total > 0 ? (
          <>
            <span aria-live="polite" className="font-mono text-xs text-muted">
              {t("transfer.position", { n: page + 1, total })}
            </span>
            <QrCode
              value={shown.uris[page]!}
              label={t("transfer.qrLabel", { n: page + 1, total })}
              size={260}
            />
            <div className="flex gap-3">
              <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                {t("transfer.prev")}
              </Button>
              <Button disabled={page >= total - 1} onClick={() => setPage(page + 1)}>
                {t("transfer.next")}
              </Button>
            </div>
            <p className="m-0 text-[13px] text-warn">{t("transfer.warning")}</p>
          </>
        ) : (
          <p className="m-0 text-sm text-warn">{t("transfer.none")}</p>
        )}
        <p className="m-0 text-[13px] text-muted">{t("transfer.checkNote")}</p>
        {shown.skipped.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-hair pt-4">
            <h3 className="m-0 text-[13px] font-medium">{t("transfer.excluded")}</h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px]">
              {shown.skipped.map((s, i) => (
                <li key={i}>
                  <span>{s.name}</span>{" "}
                  <span className="text-muted">
                    {t(REASONS[s.reason] ?? "transfer.reason.type")}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p role="timer" className="m-0 text-xs text-muted">
          {t("account.hideIn", { seconds: secondsLeft })}
        </p>
        <Button
          onClick={() => {
            setShown(null);
            onClose();
          }}
        >
          {t("account.hide")}
        </Button>
      </div>
    );
  }

  return (
    <div ref={root} className="flex max-w-md flex-col gap-4 py-5">
      {loadFailed ? <p className="m-0 text-sm text-warn">{t("error.unknown")}</p> : null}
      <fieldset className="m-0 flex flex-col border-0 p-0">
        <legend className="mb-2 text-[13px] text-muted">{t("transfer.accounts")}</legend>
        {(accounts ?? []).map((a) => {
          const name = a.issuer ? `${a.issuer}: ${a.label}` : a.label;
          return (
            <label key={a.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onChange={() => toggle(a.id)}
                className="h-4 w-4 accent-[var(--ov-text)]"
              />
              {name}
            </label>
          );
        })}
      </fieldset>
      {selected.size > 0 ? (
        <ReauthForm
          submitLabel={t("transfer.show")}
          autoFocus={false}
          onConfirmed={async (token) => {
            const out = await rpc("exportMigration", { token, ids: [...selected] });
            setPage(0);
            setShown(out);
          }}
        />
      ) : null}
      <div>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </div>
    </div>
  );
}
