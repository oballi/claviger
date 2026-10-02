import { useEffect, useRef, useState, type FormEvent } from "react";
import { RpcError } from "@otp-vault/ui/rpc-client";
import { Button } from "@otp-vault/ui";
import { NewPasswordFields, newPasswordProblem } from "@otp-vault/ui";
import { RecoveryCodeDisplay } from "@otp-vault/ui";
import { TextField } from "@otp-vault/ui";
import { errorMessage } from "@otp-vault/ui";
import { useNow } from "@otp-vault/ui";
import { useT } from "@otp-vault/ui";
import { useUi } from "@otp-vault/ui";
import { PageTitle } from "./ManageFrame";

/** Spec §5.6: the recovery code opens the vault, a new password is set and the code is rotated. */
export function RecoverScreen({
  hasRecoveryCode,
  onSubmitting,
  onDone,
  onCancel,
}: {
  hasRecoveryCode: boolean | null;
  /** Called just before the recovery request, so the host keeps this screen once the vault opens. */
  onSubmitting?: () => void;
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
  const [waitUntil, setWaitUntil] = useState(0);
  const now = useNow(waitUntil > 0 ? 250 : 0);
  const waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const waiting = waitSeconds > 0;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The submit button disappears on success; move focus to the new screen's heading.
  useEffect(() => {
    if (fresh) headingRef.current?.focus();
  }, [fresh]);

  // Stops the 250 ms interval once the wait is over.
  useEffect(() => {
    if (waitUntil > 0 && waitSeconds === 0) setWaitUntil(0);
  }, [waitUntil, waitSeconds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || waiting) return;
    setError(null);
    const problem = newPasswordProblem(t, password, confirm);
    setPasswordError(problem);
    if (problem) return;
    setBusy(true);
    try {
      onSubmitting?.();
      const result = await rpc("unlockWithRecovery", { code: code.trim(), newPassword: password });
      setCode("");
      setPassword("");
      setConfirm("");
      setFresh(result.recoveryCode);
    } catch (e) {
      // Plaintext passwords must not linger in the DOM; the code stays so a typo can be fixed.
      setPassword("");
      setConfirm("");
      if (e instanceof RpcError && e.retryAfterMs) setWaitUntil(Date.now() + e.retryAfterMs);
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
            rpc("confirmRecoveryCode", {}).catch(() => {});
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
        {/* The live region is set once; the ticking number stays out of it. */}
        <p role="status" className="m-0 min-h-4 text-xs text-warn">
          {waitUntil > 0 ? t("lock.waitNotice") : ""}
        </p>
        <p aria-live="off" className="m-0 min-h-4 font-mono text-xs text-warn">
          {waiting ? t("lock.countdown", { seconds: waitSeconds }) : ""}
        </p>
        <div className="flex justify-between gap-3">
          <Button onClick={onCancel}>{t("common.back")}</Button>
          <Button
            type="submit"
            variant="primary"
            disabled={busy || waiting || code.trim().length === 0}
          >
            {t("recover.submit")}
          </Button>
        </div>
      </form>
    </div>
  );
}
