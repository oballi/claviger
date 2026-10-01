import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../components/Button";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { RecoveryCodeDisplay } from "../components/RecoveryCodeDisplay";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { PageTitle } from "./ManageFrame";

/** Spec §5.6: the recovery code opens the vault, a new password is set and the code is rotated. */
export function RecoverScreen({
  hasRecoveryCode,
  onDone,
  onCancel,
}: {
  hasRecoveryCode: boolean | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The submit button disappears on success; move focus to the new screen's heading.
  useEffect(() => {
    if (fresh) headingRef.current?.focus();
  }, [fresh]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const problem = newPasswordProblem(t, password, confirm);
    setPasswordError(problem);
    if (problem) return;
    setBusy(true);
    try {
      const result = await rpc("unlockWithRecovery", { code: code.trim(), newPassword: password });
      setCode("");
      setPassword("");
      setConfirm("");
      setFresh(result.recoveryCode);
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  if (fresh) {
    return (
      <div className="flex max-w-[640px] flex-col gap-10">
        <PageTitle title={t("recover.freshTitle")} headingRef={headingRef}>
          {t("recover.fresh")}
        </PageTitle>
        <RecoveryCodeDisplay
          code={fresh}
          doneLabel={t("recover.done")}
          onDone={() => {
            setFresh(null);
            onDone();
          }}
        />
      </div>
    );
  }

  if (hasRecoveryCode === false) {
    return (
      <div className="flex max-w-[640px] flex-col gap-8">
        <PageTitle title={t("recover.title")}>{t("recover.none")}</PageTitle>
        <div>
          <Button onClick={onCancel}>{t("common.back")}</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex max-w-[480px] flex-col gap-10">
      <PageTitle title={t("recover.title")}>{t("recover.body")}</PageTitle>
      <form onSubmit={submit} noValidate className="flex flex-col gap-8">
        <TextField
          id="recovery-code-input"
          label={t("recover.code")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          mono
        />
        <NewPasswordFields
          password={password}
          confirm={confirm}
          onPassword={setPassword}
          onConfirm={setConfirm}
          error={passwordError}
          labels={{ password: t("recover.newPassword") }}
          autoFocus={false}
        />
        <p role="alert" className="m-0 min-h-4 text-sm text-warn">
          {error}
        </p>
        <div className="flex justify-between gap-3">
          <Button onClick={onCancel}>{t("common.back")}</Button>
          <Button type="submit" variant="primary" disabled={busy || code.trim().length === 0}>
            {t("recover.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
