import { passwordStrength } from "../format";
import { useT, type Translate } from "../i18n/i18n";
import { TextField } from "./TextField";

export function newPasswordProblem(t: Translate, password: string, confirm: string): string | null {
  if (password.length < 8) return t("password.tooShort");
  if (password !== confirm) return t("password.mismatch");
  return null;
}

export function NewPasswordFields({
  password,
  confirm,
  onPassword,
  onConfirm,
  error,
  labels,
  idPrefix = "new",
  autoFocus = true,
}: {
  password: string;
  confirm: string;
  onPassword: (value: string) => void;
  onConfirm: (value: string) => void;
  error?: string | null;
  labels?: { password?: string; confirm?: string };
  idPrefix?: string;
  autoFocus?: boolean;
}) {
  const t = useT();
  const score = passwordStrength(password);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <TextField
          id={`${idPrefix}-password`}
          type="password"
          autoComplete="new-password"
          label={labels?.password ?? t("password.new")}
          value={password}
          onChange={(e) => onPassword(e.target.value)}
          autoFocus={autoFocus}
          mono
        />
        <div className="flex gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={`h-0.5 flex-1 ${i <= score ? (score === 1 ? "bg-warn" : "bg-text") : "bg-hair"}`}
            />
          ))}
        </div>
        <div className="flex justify-between gap-4 text-xs text-muted">
          <span>
            <span className="text-text">{t(`password.strength.${score}`)}</span>{" "}
            {t("password.hint")}
          </span>
          <span className="shrink-0 font-mono">
            {t("password.length", { count: password.length })}
          </span>
        </div>
      </div>
      <TextField
        id={`${idPrefix}-confirm`}
        type="password"
        autoComplete="new-password"
        label={labels?.confirm ?? t("password.confirm")}
        value={confirm}
        onChange={(e) => onConfirm(e.target.value)}
        error={error}
        mono
      />
    </div>
  );
}
