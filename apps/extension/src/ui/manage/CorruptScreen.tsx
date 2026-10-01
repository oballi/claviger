import { useState, type FormEvent } from "react";
import type { ServiceState } from "../../background/vaultService";
import { Button } from "../components/Button";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

const norm = (s: string) => s.normalize("NFC").trim();

export function CorruptScreen({
  storageArea,
  onDone,
}: {
  storageArea: ServiceState["storageArea"];
  onDone: () => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = t("corrupt.word");
  const matches = norm(typed) === norm(word);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rpc("quarantineVault", {});
      onDone();
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4 pt-6">
      <p className="m-0 text-[13px] leading-normal text-muted">{t("corrupt.moveBody")}</p>
      {storageArea === "sync" ? (
        <p className="m-0 text-[13px] leading-normal text-warn">{t("corrupt.syncWarning")}</p>
      ) : null}
      <TextField
        id="corrupt-confirm"
        label={t("corrupt.type", { word })}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        autoComplete="off"
      />
      {error ? (
        <p role="alert" className="m-0 text-xs text-warn">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="danger" disabled={!matches || busy}>
          {t("corrupt.submit")}
        </Button>
      </div>
    </form>
  );
}
