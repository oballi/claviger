import { useEffect, useState, type FormEvent } from "react";
import { RpcError } from "../rpc/client";
import { errorMessage } from "../errors";
import { useNow } from "../hooks";
import { useT, type MessageKey } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";
import { TextField } from "./TextField";

/**
 * Asks for the master password before a sensitive action. Each submit fetches its own
 * single-use token; `onConfirmed` failures are shown here and keep the form open.
 */
export function ReauthForm({
  onConfirmed,
  submitLabel,
  autoFocus = true,
  disabled = false,
  errorKeys,
}: {
  onConfirmed: (token: string, password: string) => void | Promise<void>;
  submitLabel: string;
  /** Off when the form appears while the user is still typing elsewhere. */
  autoFocus?: boolean;
  disabled?: boolean;
  /** Context-specific wording for error codes, e.g. `already-set-up` while moving storage. */
  errorKeys?: Record<string, MessageKey>;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const now = useNow(waitUntil > 0 ? 250 : 0);
  const waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const waiting = waitSeconds > 0;

  // Stops the 250 ms interval once the wait is over.
  useEffect(() => {
    if (waitUntil > 0 && waitSeconds === 0) setWaitUntil(0);
  }, [waitUntil, waitSeconds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled || busy || waiting) return;
    setBusy(true);
    setError(null);
    try {
      const { token } = await rpc("reauth", { password });
      await onConfirmed(token, password);
    } catch (e) {
      if (e instanceof RpcError && e.retryAfterMs) setWaitUntil(Date.now() + e.retryAfterMs);
      setError(errorMessage(t, e, errorKeys));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <TextField
        id="reauth-password"
        type="password"
        autoComplete="current-password"
        label={t("reauth.password")}
        hint={t("reauth.hint")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={error}
        autoFocus={autoFocus}
        mono
      />
      {/* The live region is set once; the ticking number stays out of it. */}
      <p role="status" className="m-0 min-h-4 text-xs text-warn">
        {waitUntil > 0 ? t("lock.waitNotice") : ""}
      </p>
      <p aria-live="off" className="m-0 min-h-4 font-mono text-xs text-warn">
        {waiting ? t("lock.countdown", { seconds: waitSeconds }) : ""}
      </p>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || busy || waiting || password.length === 0}
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
