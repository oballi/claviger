import { useRef, useState, type FormEvent } from "react";
import { RpcError } from "../../rpc/client";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";
import { TextField } from "./TextField";

const selectClass =
  "h-11 border-0 border-b border-line bg-transparent px-0 text-sm text-text outline-none";

/**
 * Manual entry. The current tab's site is bound only when the user leaves the checkbox ticked:
 * binding silently would scope a bank account to whatever page happened to be open.
 */
export function AccountForm({
  tabUrl,
  tabDomain,
  onAdded,
}: {
  tabUrl?: string;
  tabDomain?: string | null;
  onAdded: (name: string) => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const domain = tabDomain ?? null;
  const [secret, setSecret] = useState("");
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [type, setType] = useState("totp");
  const [algorithm, setAlgorithm] = useState("SHA1");
  const [digits, setDigits] = useState("6");
  const [period, setPeriod] = useState("30");
  const [bind, setBind] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sameName, setSameName] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const digitsRef = useRef<HTMLSelectElement>(null);
  const periodRef = useRef<HTMLInputElement>(null);

  // Any edit clears the warning: the next submit must be checked against the new values again.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setSameName(false);
    setError(null);
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = secret.trim();
    const isUri = /^otpauth:\/\//i.test(value);
    if (!isUri) {
      const badDigits =
        type !== "steam" &&
        (!/^\d+$/.test(digits.trim()) || Number(digits) < 6 || Number(digits) > 8);
      const badPeriod =
        type === "totp" &&
        (!/^\d+$/.test(period.trim()) || Number(period) < 1 || Number(period) > 300);
      if (badDigits || badPeriod) {
        setError(t("error.invalid-otp-params"));
        setAdvancedOpen(true);
        // Focus after the <details> opens, otherwise the hidden input cannot take focus.
        setTimeout(() => (badDigits ? digitsRef : periodRef).current?.focus(), 0);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const sourceUrl = domain && bind ? tabUrl : undefined;
    const allowSameName = sameName ? true : undefined;
    try {
      let name: string;
      if (isUri) {
        ({ name } = await rpc("addAccountUri", { uri: value, sourceUrl, allowSameName }));
      } else {
        ({ name } = await rpc("addAccountManual", {
          sourceUrl,
          allowSameName,
          draft: {
            secret: value,
            issuer,
            label,
            type,
            algorithm,
            digits: Number(digits),
            period: Number(period),
          },
        }));
      }
      onAdded(name || t("add.unnamed"));
    } catch (e) {
      setSameName(e instanceof RpcError && e.code === "same-name");
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        id="add-secret"
        label={t("add.secret")}
        value={secret}
        onChange={(e) => edit(setSecret)(e.target.value)}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        mono
      />
      <TextField
        id="add-issuer"
        label={t("add.issuer")}
        value={issuer}
        onChange={(e) => edit(setIssuer)(e.target.value)}
      />
      <TextField
        id="add-label"
        label={t("add.label")}
        value={label}
        onChange={(e) => edit(setLabel)(e.target.value)}
      />
      <details
        className="text-sm"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}
      >
        <summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted">
          {t("add.advanced")}
        </summary>
        <div className="grid grid-cols-2 gap-4 pt-2">
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {t("add.type")}
            <select
              className={selectClass}
              value={type}
              onChange={(e) => edit(setType)(e.target.value)}
            >
              <option value="totp">TOTP</option>
              <option value="hotp">HOTP</option>
              <option value="steam">Steam</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {t("add.algorithm")}
            <select
              className={selectClass}
              value={algorithm}
              onChange={(e) => edit(setAlgorithm)(e.target.value)}
            >
              <option value="SHA1">SHA1</option>
              <option value="SHA256">SHA256</option>
              <option value="SHA512">SHA512</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {t("add.digits")}
            <select
              ref={digitsRef}
              className={selectClass}
              value={digits}
              onChange={(e) => edit(setDigits)(e.target.value)}
            >
              <option value="6">6</option>
              <option value="7">7</option>
              <option value="8">8</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs text-muted">
            {t("add.period")}
            <input
              className={selectClass}
              ref={periodRef}
              inputMode="numeric"
              value={period}
              onChange={(e) => edit(setPeriod)(e.target.value)}
            />
          </label>
        </div>
      </details>
      {domain ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
          <input
            type="checkbox"
            checked={bind}
            onChange={(e) => {
              setBind(e.target.checked);
              setSameName(false);
              setError(null);
            }}
            className="h-4 w-4 accent-[var(--ov-text)]"
          />
          {t("add.bind", { domain })}
        </label>
      ) : null}
      <p role="alert" className="m-0 min-h-4 text-xs text-warn">
        {error}
      </p>
      <div>
        <Button type="submit" variant="primary" disabled={busy || secret.trim().length === 0}>
          {sameName ? t("add.saveAnyway") : t("add.submit")}
        </Button>
      </div>
    </form>
  );
}
