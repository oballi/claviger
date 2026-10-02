import { useEffect, useRef, useState } from "react";
import { REVEAL_SECONDS } from "../popup/reveal";
import type { LockPolicy, OpenMode, PopupSize, ServiceState, ViewMode } from "../contract/views";
import { Button } from "../components/Button";
import { NewPasswordFields, newPasswordProblem } from "../components/NewPasswordFields";
import { Notice } from "../components/Notice";
import { ReauthForm } from "../components/ReauthForm";
import { RecoveryCodeDisplay } from "../components/RecoveryCodeDisplay";
import { TextField } from "../components/TextField";
import { errorMessage } from "../errors";
import { lockPolicyLabel } from "../format";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { ClockRow } from "./ClockRow";
import { LanguagePicker } from "./LanguagePicker";
import { ThemePicker } from "./ThemePicker";
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

const OPEN_MODES: OpenMode[] = ["popup", "window", "panel"];
const POPUP_SIZES: PopupSize[] = ["small", "medium", "large"];

const policyKey = (p: LockPolicy) => (p.kind === "timeout" ? `timeout-${p.minutes}` : p.kind);

const VIEW_MODES: ViewMode[] = ["normal", "compact", "hidden"];
const CLIPBOARD_SECONDS = [30, 60, 0] as const;

const selectClass =
  "h-11 rounded-full border border-line bg-bg px-3 font-sans text-[13px] text-text";

/** Design board "Yönetim — güvenlik". Every change asks for the master password (spec §5.4). */
export function SecurityScreen({
  state,
  onChanged,
  onDeleted,
}: {
  state: ServiceState;
  onChanged: () => void;
  /** Lets the host route to setup / the "found" lock screen; the vault may be adopted from the other area. */
  onDeleted?: () => void;
}) {
  const { rpc, reportsScreenLock, capabilities } = useUi();
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
  const root = useRef<HTMLDivElement>(null);
  const focusAfter = useRef<Panel>(null);
  // While a new code is pending, the old one is already invalid, so nothing may discard it.
  const codePending = freshCode !== null;

  // Closing a panel hides its button; focus would otherwise fall to <body>.
  useEffect(() => {
    if (panel !== null || !focusAfter.current) return;
    root.current?.querySelector<HTMLElement>(`[data-action="${focusAfter.current}"]`)?.focus();
    focusAfter.current = null;
  }, [panel]);

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

  function done(text: string, from: Panel) {
    setNewPassword("");
    setConfirm("");
    focusAfter.current = from;
    setPanel(null);
    setMessage(text);
    onChanged();
  }

  async function savePreference(action: () => Promise<unknown>, text = t("security.saved")) {
    setMessage("");
    try {
      await action();
      setMessage(text);
      onChanged();
    } catch (e) {
      setMessage(errorMessage(t, e));
    }
  }

  const cancel = (
    <div>
      <Button onClick={() => open(null)}>{t("common.cancel")}</Button>
    </div>
  );

  return (
    <div ref={root} className="flex flex-col gap-12">
      <PageTitle title={t("security.title")}>{t("security.body")}</PageTitle>
      <p role="status" className="m-0 -my-6 min-h-4 text-sm">
        {message}
      </p>
      {state.hasRecoveryCode && !state.recoveryCodeConfirmed && !codePending ? (
        <div className="flex flex-col gap-3">
          <Notice label={t("security.recovery")} tone="warn">
            {t("security.recoveryUnconfirmed")}
          </Notice>
          <div className="flex gap-2">
            <Button
              onClick={() =>
                void savePreference(
                  () => rpc("confirmRecoveryCode", {}),
                  t("security.recoveryConfirmed"),
                )
              }
            >
              {t("security.recoveryConfirm")}
            </Button>
            <Button onClick={() => open("recovery")}>{t("security.recoveryNew")}</Button>
          </div>
        </div>
      ) : null}
      {codePending ? (
        <p className="m-0 text-[13px] text-warn">{t("security.saveCodeFirst")}</p>
      ) : null}

      <SettingsSection num="01" title={t("security.access")}>
        <SettingsRow
          title={t("security.password")}
          description={t("security.passwordHint")}
          action={
            panel === "password" ? null : (
              <Button
                data-action="password"
                disabled={codePending}
                onClick={() => open("password")}
              >
                {t("security.passwordChange")}
              </Button>
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
                  setNewPassword("");
                  setConfirm("");
                  done(t("security.passwordChanged"), "password");
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
              <Button data-action="recovery" onClick={() => open("recovery")}>
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
                // Await so the reminder never flashes before the flag is stored.
                void rpc("confirmRecoveryCode", {})
                  .catch(() => {})
                  .then(() => {
                    setFreshCode(null);
                    done(t("security.recoveryCreated"), "recovery");
                  });
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
              data-action="lock"
              disabled={codePending}
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
              {policy.kind === "browser-close-or-screen-lock" && !reportsScreenLock ? (
                <p className="m-0 text-[13px] text-muted">{t("picker.screenLock.firefox")}</p>
              ) : null}
              <ReauthForm
                submitLabel={t("common.save")}
                autoFocus={false}
                onConfirmed={async (token) => {
                  await rpc("setLockPolicy", { token, policy });
                  done(t("security.saved"), "lock");
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection num="02" title={t("security.display")}>
        {capabilities.autofill ? (
          <>
            <SettingsRow title={t("security.shortcut")} description={t("security.shortcutHint")} />
            <SettingsRow
              title={t("security.lockShortcut")}
              description={t("security.lockShortcutHint")}
            />
          </>
        ) : null}
        {capabilities.clockCheck ? (
          <ClockRow state={state} disabled={codePending} onChanged={onChanged} />
        ) : null}
        <SettingsRow
          title={t("security.view")}
          description={`${t("security.viewHint")} ${state.viewMode === "hidden" ? t("view.hiddenHint", { seconds: REVEAL_SECONDS }) : ""}`.trim()}
          action={
            <select
              aria-label={t("security.view")}
              disabled={codePending}
              className={selectClass}
              value={state.viewMode}
              onChange={(e) =>
                void savePreference(() => rpc("setViewMode", { mode: e.target.value as ViewMode }))
              }
            >
              {VIEW_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`view.${m}`)}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          title={t("security.openMode")}
          description={t("security.openModeHint")}
          action={
            <select
              aria-label={t("security.openMode")}
              disabled={codePending}
              className={selectClass}
              value={state.openMode}
              onChange={(e) =>
                void savePreference(() => rpc("setOpenMode", { mode: e.target.value as OpenMode }))
              }
            >
              {OPEN_MODES.map((m) => (
                <option key={m} value={m}>
                  {t(`openMode.${m}`)}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          title={t("security.popupSize")}
          description={t("security.popupSizeHint")}
          action={
            <select
              aria-label={t("security.popupSize")}
              disabled={codePending || state.openMode !== "popup"}
              className={selectClass}
              value={state.popupSize}
              onChange={(e) =>
                void savePreference(() =>
                  rpc("setPopupSize", { size: e.target.value as PopupSize }),
                )
              }
            >
              {POPUP_SIZES.map((s) => (
                <option key={s} value={s}>
                  {t(`popupSize.${s}`)}
                </option>
              ))}
            </select>
          }
        />
        <SettingsRow
          title={t("security.clipboard")}
          description={t("security.clipboardHint")}
          action={
            <select
              aria-label={t("security.clipboard")}
              disabled={codePending}
              className={selectClass}
              value={state.clipboardClearSec}
              onChange={(e) =>
                void savePreference(() =>
                  rpc("setClipboardClear", {
                    seconds: Number(e.target.value) as (typeof CLIPBOARD_SECONDS)[number],
                  }),
                )
              }
            >
              {CLIPBOARD_SECONDS.map((s) => (
                <option key={s} value={s}>
                  {t(`clipboard.${s}`)}
                </option>
              ))}
            </select>
          }
        />
      </SettingsSection>

      <SettingsSection num="03" title={t("theme.section")}>
        <ThemePicker theme={state.theme} onSaved={onChanged} />
        <LanguagePicker language={state.language} onSaved={onChanged} />
      </SettingsSection>

      <SettingsSection num="04" title={t("security.secrets")}>
        <SettingsRow
          title={t("security.reveal")}
          description={t("security.revealHint")}
          action={
            <span className="flex min-h-11 min-w-11 items-center justify-center">
              <input
                type="checkbox"
                role="switch"
                aria-label={t("security.reveal")}
                data-action="reveal"
                disabled={codePending}
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
                  done(t("security.saved"), "reveal");
                }}
              />
              {cancel}
            </>
          ) : null}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection num="05" title={t("security.danger")}>
        <SettingsRow
          title={t("security.delete")}
          description={
            state.storageArea === "sync" ? t("security.deleteHintSync") : t("security.deleteHint")
          }
          action={
            panel === "delete" ? null : (
              <Button
                variant="danger"
                data-action="delete"
                disabled={codePending}
                onClick={() => open("delete")}
              >
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
                disabled={
                  deleteWord.normalize("NFC").trim() !== t("security.deleteWord").normalize("NFC")
                }
                onConfirmed={async (token) => {
                  await rpc("deleteVault", { token });
                  onDeleted?.();
                  done(t("security.deleted"), "delete");
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
