import { parseOtpauthUri } from "@otp-vault/core";
import { useState, type FormEvent } from "react";
import type { AccountView } from "../../background/vaultService";
import { RpcError } from "../../rpc/client";
import { Button } from "../components/Button";
import { Dialog } from "../components/Dialog";
import { QrCode } from "../components/QrCode";
import { ReauthForm } from "../components/ReauthForm";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

type Mode = "main" | "delete" | "reveal";

export const typeLabel = (type: string) => (type === "steam" ? "Steam" : type.toUpperCase());

const groupSecret = (secret: string) => secret.match(/.{1,4}/g)?.join(" ") ?? secret;

/** The "Düzenle" dialog of the Accounts page: edit, pin, reorder, reveal and delete one account. */
export function AccountEditor({
  account,
  revealRequiresPassword,
  canMove,
  onMove,
  onClose,
  onChanged,
}: {
  account: AccountView;
  revealRequiresPassword: boolean;
  canMove: { up: boolean; down: boolean };
  onMove: (delta: -1 | 1) => Promise<void>;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const { rpc, copy } = useUi();
  const t = useT();
  const name = account.issuer || account.label;
  const [mode, setMode] = useState<Mode>("main");
  const [issuer, setIssuer] = useState(account.issuer);
  const [label, setLabel] = useState(account.label);
  const [domains, setDomains] = useState(account.domains.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ uri: string; secret: string } | null>(null);
  // Starts from the cached setting but falls back to asking if the service says otherwise.
  const [needsPassword, setNeedsPassword] = useState(revealRequiresPassword);

  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await action();
      onChanged(message);
    } catch (e) {
      setError(errorMessage(t, e));
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const list = domains
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    void run(
      () =>
        rpc("updateAccount", {
          id: account.id,
          patch: { issuer: issuer.trim(), label: label.trim(), domains: list },
        }),
      t("accounts.saved", { name: issuer.trim() || label.trim() || name }),
    );
  }

  async function reveal(token?: string) {
    const { uri } = await rpc(
      "revealSecret",
      token ? { token, id: account.id } : { id: account.id },
    );
    setRevealed({ uri, secret: parseOtpauthUri(uri).secret });
  }

  const details: [string, string][] = [
    [t("add.type"), typeLabel(account.type)],
    [t("add.algorithm"), account.algorithm],
    [t("add.digits"), String(account.digits)],
    [
      t("account.period"),
      account.type === "hotp" ? "—" : t("account.periodValue", { n: account.period }),
    ],
  ];

  return (
    <Dialog title={name} onClose={onClose}>
      {mode === "main" ? (
        <>
          <form onSubmit={save} className="flex flex-col gap-5">
            <TextField
              id="edit-issuer"
              label={t("add.issuer")}
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
            />
            <TextField
              id="edit-label"
              label={t("add.label")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <TextField
              id="edit-domains"
              label={t("account.domains")}
              hint={t("account.domainsHint")}
              value={domains}
              onChange={(e) => setDomains(e.target.value)}
              mono
            />
            <div>
              <Button type="submit" variant="primary">
                {t("common.save")}
              </Button>
            </div>
          </form>
          <dl className="m-0 grid grid-cols-4 gap-4 border-y border-hair py-4">
            {details.map(([term, value]) => (
              <div key={term} className="flex flex-col gap-1">
                <dt className="text-xs text-muted">{term}</dt>
                <dd className="m-0 font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                void run(
                  () => rpc("setPinned", { id: account.id, pinned: !account.pinned }),
                  account.pinned
                    ? t("accounts.unpinned", { name })
                    : t("accounts.pinned", { name }),
                )
              }
            >
              {account.pinned ? t("account.unpin") : t("account.pin")}
            </Button>
            <Button
              disabled={!canMove.up}
              onClick={() => void run(() => onMove(-1), t("accounts.moved", { name }))}
            >
              {t("account.moveUp")}
            </Button>
            <Button
              disabled={!canMove.down}
              onClick={() => void run(() => onMove(1), t("accounts.moved", { name }))}
            >
              {t("account.moveDown")}
            </Button>
            <Button
              onClick={() => {
                setError(null);
                setMode("reveal");
                if (!needsPassword)
                  reveal().catch((e) => {
                    if (e instanceof RpcError && e.code === "invalid-token") setNeedsPassword(true);
                    else setError(errorMessage(t, e));
                  });
              }}
            >
              {t("account.reveal")}
            </Button>
            <Button variant="danger" onClick={() => setMode("delete")}>
              {t("account.delete")}
            </Button>
          </div>
        </>
      ) : null}

      {mode === "delete" ? (
        <div className="flex flex-col gap-5">
          <p className="m-0 text-sm leading-relaxed">{t("account.deleteConfirm", { name })}</p>
          <div className="flex gap-2">
            <Button onClick={() => setMode("main")}>{t("common.cancel")}</Button>
            <Button
              variant="danger"
              onClick={() =>
                void run(
                  () => rpc("deleteAccount", { id: account.id }),
                  t("accounts.deleted", { name }),
                )
              }
            >
              {t("account.deleteYes")}
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "reveal" && !revealed && needsPassword ? (
        <ReauthForm
          submitLabel={t("account.revealSubmit")}
          onConfirmed={(token) => reveal(token)}
        />
      ) : null}

      {mode === "reveal" && revealed ? (
        <div className="flex flex-col items-start gap-5">
          <QrCode value={revealed.uri} label={t("account.qrLabel", { name })} />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted">{t("account.secret")}</span>
            <code className="font-mono text-lg tracking-widest break-all">
              {groupSecret(revealed.secret)}
            </code>
          </div>
          <Button onClick={() => void copy(revealed.secret)}>{t("account.copySecret")}</Button>
          <p className="m-0 text-[13px] text-warn">{t("account.revealWarning")}</p>
        </div>
      ) : null}

      <p role="alert" className="m-0 min-h-4 text-sm text-warn">
        {error}
      </p>
    </Dialog>
  );
}
