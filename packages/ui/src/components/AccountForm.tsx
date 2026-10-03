import { useState, type ClipboardEvent, type FormEvent } from "react";
import { RpcError } from "../rpc/client";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { parseOtpauthFill } from "../otpauthFill";
import { Button } from "./Button";
import { Icon } from "./Icon";
import { TextField } from "./TextField";

const selectClass =
  "h-11 border-0 border-b border-line bg-transparent px-0 text-sm text-text outline-none";

type Field = "secret" | "type" | "algorithm" | "digits" | "period";
type FieldErrors = Partial<Record<Field, string>>;
const FIELD_ORDER: Field[] = ["secret", "type", "algorithm", "digits", "period"];
const ADVANCED: Field[] = ["type", "algorithm", "digits", "period"];

/** RPC error code to the field it is about; codes not listed stay form-level. */
const CODE_FIELD: Record<string, Field> = {
  "invalid-base32": "secret",
  "invalid-uri": "secret",
  "duplicate-account": "secret",
  "unsupported-otp-type": "type",
  "unsupported-algorithm": "algorithm",
};

function FieldError({ id, message }: { id: string; message?: string }) {
  return message ? (
    <p id={`${id}-error`} role="alert" className="m-0 text-xs text-warn">
      {message}
    </p>
  ) : null;
}

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [counter, setCounter] = useState<number | undefined>(undefined);

  // Any edit clears the warning: the next submit must be checked against the new values again.
  const edit = (set: (value: string) => void) => (value: string) => {
    set(value);
    setSameName(false);
    setError(null);
    setFieldErrors({});
  };

  // Focus after the disclosure has rendered, otherwise a collapsed field cannot take focus.
  function showFieldErrors(errors: FieldErrors) {
    setFieldErrors(errors);
    const first = FIELD_ORDER.find((f) => errors[f]);
    if (!first) return;
    if (ADVANCED.includes(first)) setAdvancedOpen(true);
    setTimeout(() => {
      const el = document.getElementById(`add-${first}`);
      el?.focus();
      el?.scrollIntoView?.({ block: "nearest" });
    }, 0);
  }

  function fillFrom(text: string, event: ClipboardEvent) {
    const fill = parseOtpauthFill(text);
    if (!fill) return;
    event.preventDefault();
    setSecret(fill.secret);
    setIssuer(fill.issuer);
    setLabel(fill.label);
    setType(fill.type);
    setAlgorithm(fill.algorithm);
    setDigits(fill.digits);
    setPeriod(fill.period);
    setCounter(fill.counter);
    setSameName(false);
    setError(null);
    setFieldErrors({});
    if (
      fill.type !== "totp" ||
      fill.algorithm !== "SHA1" ||
      fill.digits !== "6" ||
      fill.period !== "30"
    )
      setAdvancedOpen(true);
  }
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) =>
    fillFrom(event.clipboardData.getData("text"), event);

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
        const message = t("error.invalid-otp-params");
        showFieldErrors({
          ...(badDigits ? { digits: message } : {}),
          ...(badPeriod ? { period: message } : {}),
        });
        return;
      }
    }
    setBusy(true);
    setError(null);
    setFieldErrors({});
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
            ...(type === "hotp" && counter !== undefined ? { counter } : {}),
          },
        }));
      }
      onAdded(name || t("add.unnamed"));
    } catch (e) {
      setSameName(e instanceof RpcError && e.code === "same-name");
      const field = e instanceof RpcError ? CODE_FIELD[e.code] : undefined;
      if (field) showFieldErrors({ [field]: errorMessage(t, e) });
      else setError(errorMessage(t, e));
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
        onPaste={onPaste}
        error={fieldErrors.secret}
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
        onPaste={onPaste}
      />
      <TextField
        id="add-label"
        label={t("add.label")}
        value={label}
        onChange={(e) => edit(setLabel)(e.target.value)}
      />
      <div className="text-sm">
        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="add-advanced"
          onClick={() => setAdvancedOpen((open) => !open)}
          className="flex min-h-11 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 font-sans text-xs text-muted"
        >
          <Icon name="next" size={12} className={advancedOpen ? "rotate-90" : ""} />
          {t("add.advanced")}
        </button>
        {advancedOpen ? (
          <div id="add-advanced" className="grid grid-cols-2 gap-4 pt-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-type" className="text-xs text-muted">
                {t("add.type")}
              </label>
              <select
                id="add-type"
                className={selectClass}
                value={type}
                aria-invalid={fieldErrors.type ? true : undefined}
                aria-describedby={fieldErrors.type ? "add-type-error" : undefined}
                onChange={(e) => edit(setType)(e.target.value)}
              >
                <option value="totp">TOTP</option>
                <option value="hotp">HOTP</option>
                <option value="steam">Steam</option>
              </select>
              <FieldError id="add-type" message={fieldErrors.type} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-algorithm" className="text-xs text-muted">
                {t("add.algorithm")}
              </label>
              <select
                id="add-algorithm"
                className={selectClass}
                value={algorithm}
                aria-invalid={fieldErrors.algorithm ? true : undefined}
                aria-describedby={fieldErrors.algorithm ? "add-algorithm-error" : undefined}
                onChange={(e) => edit(setAlgorithm)(e.target.value)}
              >
                <option value="SHA1">SHA1</option>
                <option value="SHA256">SHA256</option>
                <option value="SHA512">SHA512</option>
              </select>
              <FieldError id="add-algorithm" message={fieldErrors.algorithm} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-digits" className="text-xs text-muted">
                {t("add.digits")}
              </label>
              <select
                id="add-digits"
                className={selectClass}
                value={digits}
                aria-invalid={fieldErrors.digits ? true : undefined}
                aria-describedby={fieldErrors.digits ? "add-digits-error" : undefined}
                onChange={(e) => edit(setDigits)(e.target.value)}
              >
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8</option>
              </select>
              <FieldError id="add-digits" message={fieldErrors.digits} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="add-period" className="text-xs text-muted">
                {t("add.period")}
              </label>
              <input
                id="add-period"
                className={selectClass}
                inputMode="numeric"
                value={period}
                aria-invalid={fieldErrors.period ? true : undefined}
                aria-describedby={fieldErrors.period ? "add-period-error" : undefined}
                onChange={(e) => edit(setPeriod)(e.target.value)}
              />
              <FieldError id="add-period" message={fieldErrors.period} />
            </div>
          </div>
        ) : null}
      </div>
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
      {error ? (
        <p role="alert" className="m-0 text-xs text-warn">
          {error}
        </p>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={busy || secret.trim().length === 0}>
          {sameName ? t("add.saveAnyway") : t("add.submit")}
        </Button>
      </div>
    </form>
  );
}
