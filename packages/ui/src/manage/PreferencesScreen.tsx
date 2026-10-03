import { useState } from "react";
import type { OpenMode, PopupSize, ServiceState, ViewMode } from "../contract/views";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { REVEAL_SECONDS } from "../popup/reveal";
import { ClockRow } from "./ClockRow";
import { LanguagePicker } from "./LanguagePicker";
import { PageTitle, SettingsRow, SettingsSection } from "./ManageFrame";
import { ThemePicker } from "./ThemePicker";

const VIEW_MODES: ViewMode[] = ["normal", "compact", "hidden"];
const OPEN_MODES: OpenMode[] = ["popup", "window", "panel"];
const POPUP_SIZES: PopupSize[] = ["small", "medium", "large"];

const selectClass =
  "h-11 rounded-full border border-line bg-bg px-3 font-sans text-[13px] text-text";

/** Appearance and usage settings. None of them asks for the master password. */
export function PreferencesScreen({
  state,
  onChanged,
}: {
  state: ServiceState;
  onChanged: () => void;
}) {
  const { rpc, capabilities } = useUi();
  const t = useT();
  const [message, setMessage] = useState("");

  async function savePreference(action: () => Promise<unknown>) {
    setMessage("");
    try {
      await action();
      setMessage(t("security.saved"));
      onChanged();
    } catch (e) {
      setMessage(errorMessage(t, e));
    }
  }

  return (
    <div className="flex flex-col gap-12">
      <PageTitle title={t("preferences.title")}>{t("preferences.body")}</PageTitle>
      <p role="status" className="m-0 -my-6 min-h-4 text-sm">
        {message}
      </p>

      <SettingsSection num="01" title={t("theme.section")}>
        <ThemePicker theme={state.theme} onSaved={onChanged} />
        <LanguagePicker language={state.language} onSaved={onChanged} />
        <SettingsRow
          title={t("security.view")}
          description={`${t("security.viewHint")} ${state.viewMode === "hidden" ? t("view.hiddenHint", { seconds: REVEAL_SECONDS }) : ""}`.trim()}
          action={
            <select
              aria-label={t("security.view")}
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
      </SettingsSection>

      <SettingsSection num="02" title={t("preferences.opening")}>
        <SettingsRow
          title={t("security.openMode")}
          description={t("security.openModeHint")}
          action={
            <select
              aria-label={t("security.openMode")}
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
              disabled={state.openMode !== "popup"}
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
      </SettingsSection>

      <SettingsSection num="03" title={t("preferences.shortcuts")}>
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
          <ClockRow state={state} disabled={false} onChanged={onChanged} />
        ) : null}
      </SettingsSection>
    </div>
  );
}
