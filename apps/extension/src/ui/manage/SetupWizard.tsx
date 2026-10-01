import { useId, useState, type FormEvent, type ReactNode } from "react";
import type { LockPolicy } from "../../background/settings";
import { RpcError } from "../../rpc/client";
import { AccountForm } from "../components/AccountForm";
import { Button } from "../components/Button";
import { Icon } from "../components/Icon";
import { LockPolicyOptions } from "../components/LockPolicyOptions";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { Notice } from "../components/Notice";
import { RecoveryCodeDisplay } from "../components/RecoveryCodeDisplay";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { WizardFrame } from "./WizardFrame";

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="m-0 text-[40px] leading-tight font-medium tracking-tight">{title}</h1>
      <p className="m-0 text-[15px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Choice({
  name,
  checked,
  onSelect,
  title,
  hint,
  badge,
}: {
  name: string;
  checked: boolean;
  onSelect: () => void;
  title: string;
  hint: string;
  badge?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 border-t border-hair py-4">
      <input
        id={id}
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        aria-describedby={`${id}-hint`}
        className="mt-1 h-4 w-4 accent-[var(--ov-text)]"
      />
      <div className="flex flex-col gap-1">
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 text-[15px] font-medium"
        >
          {title}
          {badge ? (
            <span className="rounded-full border border-line px-[7px] py-px font-mono text-[10px] font-normal text-muted">
              {badge}
            </span>
          ) : null}
        </label>
        <span id={`${id}-hint`} className="text-[13px] leading-normal text-muted">
          {hint}
        </span>
      </div>
    </div>
  );
}

function NumberedOption({
  num,
  title,
  hint,
  badge,
  onClick,
}: {
  num: string;
  title: string;
  hint: string;
  badge?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex w-full cursor-pointer items-start gap-4 border-0 border-t border-hair bg-transparent py-5 text-left font-sans text-text disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="pt-0.5 font-mono text-[11px] text-muted">{num}</span>
      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-center gap-2 text-[15px] font-medium">
          {title}
          {badge ? (
            <span className="rounded-full border border-line px-[7px] py-px font-mono text-[10px] font-normal text-muted">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="text-[13px] leading-normal text-muted">{hint}</span>
      </span>
      <Icon name="next" className="mt-0.5 shrink-0 text-muted" />
    </button>
  );
}

const DEFAULT_POLICY: LockPolicy = { kind: "browser-close" };

/**
 * Spec §6.1 in the design's order. The recovery code is created by `setup`, so the vault is
 * created at step 2 with default lock and storage; steps 3–4 then change those through
 * `reauth` with the password kept in state until step 4 is done.
 */
export function SetupWizard({ onFinished }: { onFinished: (next: "accounts" | "backup") => void }) {
  const { rpc } = useUi();
  const t = useT();
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [created, setCreated] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [policy, setPolicy] = useState<LockPolicy>(DEFAULT_POLICY);
  const [area, setArea] = useState<"local" | "sync">("local");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  function go(next: number) {
    setError(null);
    setStep(next);
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // The vault locked mid-setup (autolock, screen lock): drop the held password and hand over
      // to the lock screen; the vault and recovery code already exist.
      if (e instanceof RpcError && e.code === "locked" && created) {
        setPassword("");
        onFinished("accounts");
        return;
      }
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    const problem = newPasswordProblem(t, password, confirm);
    if (problem) setError(problem);
    else go(1);
  }

  const create = (withCode: boolean) =>
    run(async () => {
      const result = await rpc("setup", {
        password,
        createRecoveryCode: withCode,
        lockPolicy: DEFAULT_POLICY,
        storageArea: "local",
      });
      setCreated(true);
      setConfirm("");
      if (result.recoveryCode) setRecoveryCode(result.recoveryCode);
      else go(2);
    });

  const applyPolicy = () =>
    run(async () => {
      if (policy.kind !== DEFAULT_POLICY.kind) {
        const { token } = await rpc("reauth", { password });
        await rpc("setLockPolicy", { token, policy });
      }
      go(3);
    });

  const applyStorage = () =>
    run(async () => {
      if (area === "sync") {
        const { token } = await rpc("reauth", { password });
        await rpc("setStorageArea", { token, area });
      }
      setPassword("");
      go(4);
    });

  const alert = (
    <p role="alert" className="m-0 min-h-4 text-sm text-warn">
      {error}
    </p>
  );
  const enterHint = (
    <span className="font-mono text-[11px] text-muted">{t("setup.enterHint")}</span>
  );
  const next = (onClick: () => void, label = t("common.continue")) => (
    <Button variant="primary" disabled={busy} onClick={onClick}>
      {label}
      <Icon name="arrow" size={15} />
    </Button>
  );

  let body: ReactNode;
  let footer: ReactNode;
  switch (step) {
    case 0:
      body = (
        <>
          <Heading title={t("setup.password.title")} body={t("setup.password.body")} />
          <form id="setup-password" onSubmit={submitPassword} noValidate>
            <NewPasswordFields
              password={password}
              confirm={confirm}
              onPassword={setPassword}
              onConfirm={setConfirm}
              error={error}
            />
          </form>
          <Notice label={t("setup.importantLabel")}>{t("setup.password.notice")}</Notice>
        </>
      );
      footer = (
        <>
          {enterHint}
          <Button type="submit" form="setup-password" variant="primary">
            {t("common.continue")}
            <Icon name="arrow" size={15} />
          </Button>
        </>
      );
      break;
    case 1:
      body = recoveryCode ? (
        <>
          <Heading title={t("setup.recovery.title")} body={t("setup.recovery.body")} />
          <RecoveryCodeDisplay
            code={recoveryCode}
            doneLabel={t("common.continue")}
            onDone={() => {
              setRecoveryCode(null);
              go(2);
            }}
          />
        </>
      ) : (
        <>
          <Heading title={t("setup.recovery.title")} body={t("setup.recovery.body")} />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" disabled={busy} onClick={() => void create(true)}>
              {t("setup.recovery.create")}
            </Button>
            <Button disabled={busy} onClick={() => void create(false)}>
              {t("setup.recovery.skip")}
            </Button>
          </div>
          <Notice label={t("setup.recovery.skipLabel")} tone="warn">
            {t("setup.recovery.skipWarning")}
          </Notice>
          {alert}
        </>
      );
      footer = created ? (
        enterHint
      ) : (
        <Button onClick={() => go(0)}>
          <Icon name="back" size={15} />
          {t("common.back")}
        </Button>
      );
      break;
    case 2:
      body = (
        <>
          <Heading title={t("setup.lock.title")} body={t("setup.lock.body")} />
          <LockPolicyOptions value={policy} onChange={setPolicy} />
          {alert}
        </>
      );
      footer = (
        <>
          <span />
          {next(() => void applyPolicy())}
        </>
      );
      break;
    case 3:
      body = (
        <>
          <Heading title={t("setup.storage.title")} body={t("setup.storage.body")} />
          <fieldset className="m-0 flex flex-col border-0 border-b border-hair p-0">
            <legend className="sr-only">{t("setup.step.storage")}</legend>
            <Choice
              name="storage"
              checked={area === "local"}
              onSelect={() => setArea("local")}
              title={t("storage.local")}
              hint={t("storage.localHint")}
              badge={t("common.recommended")}
            />
            <Choice
              name="storage"
              checked={area === "sync"}
              onSelect={() => setArea("sync")}
              title={t("storage.sync")}
              hint={t("storage.syncHint")}
            />
          </fieldset>
          <Notice label={t("setup.storage.bothLabel")}>{t("setup.storage.both")}</Notice>
          {alert}
        </>
      );
      footer = (
        <>
          <span />
          {next(() => void applyStorage())}
        </>
      );
      break;
    default:
      body = (
        <>
          <Heading title={t("setup.account.title")} body={t("setup.account.body")} />
          {added ? (
            <p role="status" className="m-0 text-sm">
              {t("setup.account.added", { name: added })}
            </p>
          ) : null}
          {adding ? (
            <AccountForm
              onAdded={(name) => {
                setAdded(name);
                setAdding(false);
              }}
            />
          ) : (
            <div className="flex flex-col border-b border-hair">
              <NumberedOption
                num="01"
                title={t("add.qr")}
                hint={t("add.qrHint")}
                badge={t("add.soon")}
              />
              <NumberedOption
                num="02"
                title={t("add.manual")}
                hint={t("add.manualHint")}
                onClick={() => setAdding(true)}
              />
              <NumberedOption
                num="03"
                title={t("add.import")}
                hint={t("add.importHint")}
                onClick={() => onFinished("backup")}
              />
            </div>
          )}
        </>
      );
      footer = (
        <>
          <span />
          <Button variant={added ? "primary" : "outline"} onClick={() => onFinished("accounts")}>
            {added ? t("setup.account.finish") : t("setup.account.skip")}
          </Button>
        </>
      );
  }

  return (
    <WizardFrame step={step} footer={footer}>
      {body}
    </WizardFrame>
  );
}
