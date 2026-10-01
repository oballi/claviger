import { useState } from "react";
import type { LockPolicy } from "../../background/settings";
import type { ServiceState } from "../../background/vaultService";
import { Button } from "../components/Button";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { ReauthForm } from "../components/ReauthForm";
import { RecoveryCodeDisplay } from "../components/RecoveryCodeDisplay";
import { TextField } from "../components/TextField";
import { lockPolicyLabel } from "../format";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { PageTitle, SettingsRow, SettingsSection } from "./ManageFrame";

type Panel = "password" | "recovery" | "lock" | "reveal" | "delete" | null;

const POLICIES: LockPolicy[] = [
  { kind: "browser-close" },
  { kind: "browser-close-or-screen-lock" },
  { kind: "timeout", minutes: 15 },
  { kind: "timeout", minutes: 60 },
  { kind: "timeout", minutes: 240 },
  { kind: "never" },
];

const policyKey = (p: LockPolicy) => (p.kind === "timeout" ? `timeout-${p.minutes}` : p.kind);

const selectClass =
  "h-11 rounded-full border border-line bg-bg px-3 font-sans text-[13px] text-text";

/** Design board "Yönetim — güvenlik". Every change asks for the master password (spec §5.4). */
export function SecurityScreen({
  state,
  onChanged,
}: {
  state: ServiceState;
  onChanged: () => void;
}) {
  const { rpc, isFirefox } = useUi();
  const t = useT();
  const [panel, setPanel] = useState<Panel>(null);
  const [message, setMessage] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [passwordReady, setPasswordReady] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [freshCode, setFreshCode] = useState<string | null>(null);
  const [policy, setPolicy] = useState<LockPolicy>(state.lockPolicy);
  const [reveal, setReveal] = useState(state.revealRequiresPassword);
  const [deleteWord, setDeleteWord] = useState("");

  function open(next: Panel) {
    setMessage("");
    setPanel(next);
    setNewPassword("");
    setConfirm("");
    setPasswordReady(false);
    setPasswordError(null);
    setDeleteWord("");
    // A shown code must never reappear when the panel is reopened.
    setFreshCode(null);
    if (next !== "lock") setPolicy(state.lockPolicy);
    if (next !== "reveal") setReveal(state.revealRequiresPassword);
  }

  function done(text: string) {
    setPanel(null);
    setMessage(text);
    onChanged();
  }

  const cancel = (
    <div>
      <Button onClick={() => open(null)}>{t("common.cancel")}</Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-12">
      <PageTitle title={t("security.title")}>{t("security.body")}</PageTitle>
      <p role="status" className="m-0 -my-6 min-h-4 text-sm">
        {message}
      </p>

      <SettingsSection num="01" title={t("security.access")}>
        <SettingsRow
          title={t("security.password")}
          description={t("security.passwordHint")}
          action={
            panel === "password" ? null : (
              <Button onClick={() => open("password")}>{t("security.passwordChange")}</Button>
            )
          }
        >
          {panel === "password" && !passwordReady ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                const problem = newPasswordProblem(t, newPassword, confirm);
                setPasswordError(problem);
                if (!problem) setPasswordReady(true);
              }}
            >
              <NewPasswordFields
                password={newPassword}
                confirm={confirm}
                onPassword={setNewPassword}
                onConfirm={setConfirm}
                error={passwordError}
                labels={{ password: t("recover.newPassword") }}
                idPrefix="change"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary">
                  {t("common.continue")}
                </Button>
                <Button onClick={() => open(null)}>{t("common.cancel")}</Button>
              </div>
            </form>
          ) : null}
          {panel === "password" && passwordReady ? (
            <>
              <ReauthForm
                submitLabel={t("security.passwordChange")}
                onConfirmed={async (token) => {
                  await rpc("changePassword", { token, newPassword });
                  done(t("security.passwordChanged"));
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>

        <SettingsRow
          title={t("security.recovery")}
          description={state.hasRecoveryCode ? t("security.recoveryYes") : t("security.recoveryNo")}
          action={
            panel === "recovery" ? null : (
              <Button onClick={() => open("recovery")}>
                {state.hasRecoveryCode ? t("security.recoveryNew") : t("security.recoveryCreate")}
              </Button>
            )
          }
        >
          {panel === "recovery" && !freshCode ? (
            <>
              {state.hasRecoveryCode ? (
                <p className="m-0 text-[13px] text-warn">{t("security.recoveryWarning")}</p>
              ) : null}
              <ReauthForm
                submitLabel={t("security.recoverySubmit")}
                onConfirmed={async (token) => {
                  setFreshCode((await rpc("createRecoveryCode", { token })).recoveryCode);
                }}
              />
              {cancel}
            </>
          ) : null}
          {panel === "recovery" && freshCode ? (
            <RecoveryCodeDisplay
              code={freshCode}
              doneLabel={t("security.recoveryDone")}
              onDone={() => {
                setFreshCode(null);
                done(t("security.recoveryCreated"));
              }}
            />
          ) : null}
        </SettingsRow>

        <SettingsRow
          title={t("security.lock")}
          description={t("security.lockHint")}
          action={
            <select
              aria-label={t("picker.legend")}
              className={selectClass}
              value={policyKey(panel === "lock" ? policy : state.lockPolicy)}
              onChange={(e) => {
                const next = POLICIES.find((p) => policyKey(p) === e.target.value)!;
                open(policyKey(next) === policyKey(state.lockPolicy) ? null : "lock");
                setPolicy(next);
              }}
            >
              {POLICIES.map((p) => (
                <option key={policyKey(p)} value={policyKey(p)}>
                  {lockPolicyLabel(t, p)}
                </option>
              ))}
            </select>
          }
        >
          {panel === "lock" ? (
            <>
              {policy.kind === "never" ? (
                <p className="m-0 text-[13px] text-warn">
                  {t("picker.never.warning")} {t("picker.never.hint")}
                </p>
              ) : null}
              {policy.kind === "browser-close-or-screen-lock" && isFirefox ? (
                <p className="m-0 text-[13px] text-muted">{t("picker.screenLock.firefox")}</p>
              ) : null}
              <ReauthForm
                submitLabel={t("common.save")}
                autoFocus={false}
                onConfirmed={async (token) => {
                  await rpc("setLockPolicy", { token, policy });
                  done(t("security.saved"));
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection num="02" title={t("security.secrets")}>
        <SettingsRow
          title={t("security.reveal")}
          description={t("security.revealHint")}
          action={
            <span className="flex min-h-11 min-w-11 items-center justify-center">
              <input
                type="checkbox"
                role="switch"
                aria-label={t("security.reveal")}
                checked={panel === "reveal" ? reveal : state.revealRequiresPassword}
                onChange={(e) => {
                  const next = e.target.checked;
                  open(next === state.revealRequiresPassword ? null : "reveal");
                  setReveal(next);
                }}
                className="h-5 w-5 accent-[var(--ov-text)]"
              />
            </span>
          }
        >
          {panel === "reveal" ? (
            <>
              {!reveal ? (
                <p className="m-0 text-[13px] text-warn">{t("security.revealOffWarning")}</p>
              ) : null}
              <ReauthForm
                submitLabel={t("common.save")}
                autoFocus={false}
                onConfirmed={async (token) => {
                  await rpc("setRevealRequiresPassword", { token, value: reveal });
                  done(t("security.saved"));
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection num="03" title={t("security.danger")}>
        <SettingsRow
          title={t("security.delete")}
          description={t("security.deleteHint")}
          action={
            panel === "delete" ? null : (
              <Button variant="danger" onClick={() => open("delete")}>
                {t("security.delete")}
              </Button>
            )
          }
        >
          {panel === "delete" ? (
            <>
              <p className="m-0 text-[13px] text-warn">{t("security.deleteWarning")}</p>
              {state.storageArea === "sync" ? (
                <p className="m-0 text-[13px] text-warn">{t("security.deleteSync")}</p>
              ) : null}
              <TextField
                id="delete-word"
                label={t("security.deleteType", { word: t("security.deleteWord") })}
                value={deleteWord}
                onChange={(e) => setDeleteWord(e.target.value)}
                autoComplete="off"
                autoFocus
              />
              <ReauthForm
                submitLabel={t("security.deleteSubmit")}
                autoFocus={false}
                disabled={deleteWord.trim() !== t("security.deleteWord")}
                onConfirmed={async (token) => {
                  await rpc("deleteVault", { token });
                  done(t("security.deleted"));
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
