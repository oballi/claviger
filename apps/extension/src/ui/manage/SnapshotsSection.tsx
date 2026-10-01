import { useCallback, useEffect, useState } from "react";
import type { SnapshotInfo } from "../../background/vaultService";
import { RpcError } from "../../rpc/client";
import { Button } from "../components/Button";
import { ReauthForm } from "../components/ReauthForm";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { formatDate, snapshotReasonLabel } from "../format";
import { useLocale, useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { SettingsRow, SettingsSection } from "./ManageFrame";

// A wrong password from restoreSnapshot is the copy's old password, not the master password
// that ReauthForm just checked; a distinct code lets the form word it correctly.
const WRONG_OLD = "wrong-old-password";

export function SnapshotsSection({ num, onChanged }: { num: string; onChanged: () => void }) {
  const { rpc } = useUi();
  const t = useT();
  const locale = useLocale();
  const [items, setItems] = useState<SnapshotInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [oldPassword, setOldPassword] = useState("");
  const [needsOld, setNeedsOld] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await rpc("listSnapshots", {}));
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }, [rpc, t]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(item: SnapshotInfo) {
    setOpen(open === item.id ? null : item.id);
    setOldPassword("");
    setNeedsOld(!item.sameVault);
    setError(null);
    setMessage("");
  }

  async function restore(item: SnapshotInfo, token: string) {
    try {
      const r = await rpc(
        "restoreSnapshot",
        needsOld ? { token, id: item.id, password: oldPassword } : { token, id: item.id },
      );
      const unreadable = r.unreadable
        ? ` ${t("snapshots.resultUnreadable", { count: r.unreadable })}`
        : "";
      setMessage(`${t("snapshots.result", { added: r.added, skipped: r.skipped })}${unreadable}`);
      setOpen(null);
      setOldPassword("");
      onChanged();
      void load();
    } catch (e) {
      if (e instanceof RpcError) {
        if (e.code === "snapshot-password-required") setNeedsOld(true);
        if (e.code === "wrong-password") throw new RpcError(WRONG_OLD, "wrong old password");
      }
      throw e;
    }
  }

  return (
    <SettingsSection num={num} title={t("snapshots.title")}>
      <p className="m-0 border-b border-hair py-4 text-[13px] leading-normal text-muted">
        {t("snapshots.body")}
      </p>
      <p role="status" className="m-0 text-[13px] text-muted empty:hidden">
        {message}
      </p>
      {error ? (
        <p role="alert" className="m-0 py-3 text-[13px] text-warn">
          {error}
        </p>
      ) : null}
      {items && items.length === 0 ? (
        <p className="m-0 border-b border-hair py-4 text-[13px] text-muted">
          {t("snapshots.none")}
        </p>
      ) : null}
      {(items ?? []).map((item) => {
        const reason = snapshotReasonLabel(t, item.reason);
        const base = t("snapshots.row", { reason, count: item.accountCount });
        return (
          <SettingsRow
            key={item.id}
            title={formatDate(locale, item.createdAt)}
            description={item.sameVault ? base : `${base} · ${t("snapshots.otherVault")}`}
            action={
              <Button data-action={item.id} onClick={() => toggle(item)}>
                {t("snapshots.restore")}
              </Button>
            }
          >
            {open === item.id ? (
              <>
                <p className="m-0 text-[13px] text-muted">{t("snapshots.restoreNote")}</p>
                {needsOld ? (
                  <TextField
                    id="snapshot-old-password"
                    type="password"
                    autoComplete="off"
                    label={t("snapshots.oldPassword")}
                    hint={t("snapshots.oldPasswordHint")}
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    autoFocus
                    mono
                  />
                ) : null}
                <ReauthForm
                  autoFocus={!needsOld}
                  submitLabel={t("snapshots.restore")}
                  errorKeys={{ [WRONG_OLD]: "snapshots.wrongOldPassword" }}
                  onConfirmed={(token) => restore(item, token)}
                />
              </>
            ) : null}
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}
