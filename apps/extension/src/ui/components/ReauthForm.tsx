import { useState, type FormEvent } from "react";
import { RpcError } from "../../rpc/client";
import { errorMessage } from "../errors";
import { useNow } from "../hooks";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";
import { TextField } from "./TextField";

/**
 * Asks for the master password before a sensitive action. Each submit fetches its own
 * single-use token (spec §3.2); `onConfirmed` failures are shown here and keep the form open.
 */
export function ReauthForm({
  onConfirmed,
  submitLabel,
  autoFocus = true,
  disabled = false,
}: {
  onConfirmed: (token: string, password: string) => void | Promise<void>;
  submitLabel: string;
  /** Off when the form appears while the user is still typing elsewhere. */
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState(0);
  const now = useNow(waitUntil > 0 ? 250 : 0);
  const waiting = waitUntil > now;

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
      setError(errorMessage(t, e));
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
