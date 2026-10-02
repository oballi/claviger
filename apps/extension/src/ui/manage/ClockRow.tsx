import { useState } from "react";
import type { ServiceState } from "../../background/vaultService";
import { Button } from "../components/Button";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { SettingsRow } from "./ManageFrame";

/** Opt-in: the host permission is requested only when the user clicks, and the check never runs by itself. */
export function ClockRow({
  state,
  disabled,
  onChanged,
}: {
  state: ServiceState;
  disabled: boolean;
  onChanged: () => void;
}) {
  const { rpc, requestClockPermission, removeClockPermission, fetchServerDate } = useUi();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState("");

  async function check() {
    setText("");
    // First await: the permission prompt needs the click's user gesture.
    const granted = await requestClockPermission().catch(() => false);
    if (!granted) {
      setText(t("clock.denied"));
      return;
    }
    setBusy(true);
    try {
      await rpc("setClockCheckEnabled", { enabled: true });
      onChanged();
      let sample;
      try {
        sample = await fetchServerDate();
      } catch {
        setText(t("clock.failed"));
        return;
      }
      if (sample.endMs < sample.startMs) {
        setText(t("clock.changed"));
        return;
      }
      const { offsetSec, applied } = await rpc("applyClockSample", sample);
      setText(t(applied === 0 ? "clock.ok" : "clock.applied", { offset: offsetSec }));
      onChanged();
    } catch (e) {
      setText(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setText("");
    setBusy(true);
    try {
      await rpc("setClockCheckEnabled", { enabled: false });
      await removeClockPermission().catch(() => {});
      onChanged();
    } catch (e) {
      setText(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsRow
      title={t("clock.title")}
      description={t("clock.hint")}
      action={
        <>
          <Button disabled={disabled || busy} onClick={() => void check()}>
            {t("clock.check")}
          </Button>
          {state.clockOffsetSec !== 0 ? (
            <Button disabled={disabled || busy} onClick={() => void remove()}>
              {t("clock.remove")}
            </Button>
          ) : null}
        </>
      }
    >
      <div role="status" className="text-[13px]">
        {text}
      </div>
    </SettingsRow>
  );
}
