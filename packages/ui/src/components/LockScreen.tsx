import { useEffect, useState, type FormEvent } from "react";
import type { ServiceState } from "../contract/views";
import { RpcError } from "../rpc/client";
import { errorMessage } from "../errors";
import { lockPolicySentence } from "../format";
import { useNow } from "../hooks";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { Button } from "./Button";
import { Icon } from "./Icon";

const Dots = () => (
  <div aria-hidden="true" className="flex items-center gap-[18px]">
    {[0, 1].map((group) => (
      <div key={group} className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-[9px] w-[9px] rounded-full bg-dot" />
        ))}
      </div>
    ))}
  </div>
);

export function LockScreen({
  state,
  onUnlocked,
  onForgot,
  onChangePolicy,
  title,
}: {
  state: Pick<ServiceState, "retryAfterMs" | "lockPolicy" | "accountCount">;
  onUnlocked: () => void;
  onForgot: () => void;
  /** Absent on the manage page, where the policy is edited in Security after unlocking. */
  onChangePolicy?: () => void;
  title?: string;
}) {
  const { rpc } = useUi();
  const t = useT();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState(() =>
    state.retryAfterMs > 0 ? Date.now() + state.retryAfterMs : 0,
  );
  const now = useNow(waitUntil > 0 ? 250 : 0);
  const waitSeconds = Math.max(0, Math.ceil((waitUntil - now) / 1000));

  // Stops the 250 ms interval once the wait is over.
  useEffect(() => {
    if (waitUntil > 0 && waitSeconds === 0) setWaitUntil(0);
  }, [waitUntil, waitSeconds]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await rpc("unlock", { password });
      onUnlocked();
    } catch (e) {
      if (e instanceof RpcError && e.retryAfterMs) setWaitUntil(Date.now() + e.retryAfterMs);
      // A throttled attempt still tells the user the password was wrong (not only "wait").
      setError(e instanceof RpcError && e.code === "throttled" ? null : errorMessage(t, e));
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  const body =
    state.accountCount === null
      ? t("lock.bodyGeneric")
      : t("lock.body", { count: state.accountCount });

  return (
    <div className="flex flex-1 flex-col px-7 pt-[22px]">
      <header className="flex items-center justify-between">
        <div className="font-mono text-xs tracking-wide">{t("app.name")}</div>
        <div className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
          <Icon name="lock" size={12} />
          <span>{t("lock.badge")}</span>
        </div>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-9">
        <div className="flex flex-col gap-[22px]">
          <Dots />
          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-[28px] leading-tight font-medium tracking-tight">
              {title ?? t("lock.title")}
            </h1>
            <p className="m-0 text-sm leading-normal text-muted">{body}</p>
          </div>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="unlock-password" className="text-xs text-muted">
              {t("lock.password")}
            </label>
            <div className="ov-line flex items-center gap-2.5 border-b border-line pb-1.5">
              <input
                id="unlock-password"
                type="password"
                data-bare=""
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "unlock-error" : undefined}
                autoFocus
                className="h-11 min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-lg tracking-widest text-text outline-none"
              />
              <button
                type="submit"
                aria-label={t("lock.submit")}
                disabled={busy || waitSeconds > 0 || password.length === 0}
                className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-btn p-0 text-btn-text disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </div>
          <p id="unlock-error" role="alert" className="m-0 min-h-4 text-xs text-warn">
            {error}
          </p>
          {/* The live region is set once; the ticking number stays out of it. */}
          <p role="status" className="m-0 min-h-4 text-xs text-warn">
            {waitUntil > 0 ? t("lock.waitNotice") : ""}
          </p>
          <p aria-live="off" className="m-0 min-h-4 font-mono text-xs text-warn">
            {waitSeconds > 0 ? t("lock.countdown", { seconds: waitSeconds }) : ""}
          </p>
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-mono text-[11px]">{t("lock.enterHint")}</span>
            <Button variant="link" onClick={onForgot} className="min-w-11 text-xs">
              {t("lock.forgot")}
            </Button>
          </div>
          <p className="m-0 text-right text-[11px] text-muted">{t("lock.forgotHint")}</p>
        </form>
      </div>
      <footer className="flex items-center justify-between border-t border-hair pt-1 pb-1 text-[11px] text-muted">
        <span>{lockPolicySentence(t, state.lockPolicy)}</span>
        {onChangePolicy ? (
          <Button
            variant="link"
            onClick={onChangePolicy}
            className="min-w-11 text-[11px] text-muted"
          >
            {t("lock.changePolicy")}
          </Button>
        ) : null}
      </footer>
    </div>
  );
}
