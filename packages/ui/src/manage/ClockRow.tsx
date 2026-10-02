import { useState } from "react";
import type { ServiceState } from "../contract/views";
import { Button } from "../components/Button";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { SettingsRow } from "./ManageFrame";

// Mirrors the service cap; the UI must not import background code.
const MAX_SAMPLE_MS = 10_000;

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

  // The grant is only needed for one request, so it never outlives the attempt.
  async function dropPermission() {
    try {
      await removeClockPermission();
    } catch {
      setText((prev) => `${prev} ${t("clock.permissionKept")}`.trim());
    }
  }

  async function check() {
    setText("");
    // First await: the permission prompt needs the click's user gesture.
    const granted = await requestClockPermission().catch(() => false);
    if (!granted) {
      setText(t("clock.denied"));
      return;
    }
    setBusy(true);
    // A failed or refused re-check must not clear a working correction.
    let keepEnabled = state.clockCheckEnabled && state.clockOffsetSec !== 0;
    let result = "";
    try {
      await rpc("setClockCheckEnabled", { enabled: true });
      let sample;
      try {
        sample = await fetchServerDate();
      } catch {
        result = t("clock.failed");
      }
      if (sample) {
        if (sample.endMs < sample.startMs) {
          result = t("clock.changed");
        } else if (sample.endMs - sample.startMs > MAX_SAMPLE_MS) {
          result = t("clock.failed");
        } else {
          const { offsetSec, applied } = await rpc("applyClockSample", sample);
          keepEnabled = applied !== 0;
          result = t(keepEnabled ? "clock.applied" : "clock.ok", { offset: offsetSec });
        }
      }
    } catch (e) {
      result = errorMessage(t, e);
    }
    try {
      if (!keepEnabled) await rpc("setClockCheckEnabled", { enabled: false });
    } catch (e) {
      result = errorMessage(t, e);
    }
    setText(result);
    await dropPermission();
    onChanged();
    setBusy(false);
  }

  async function remove() {
    setText("");
    setBusy(true);
    try {
      await rpc("setClockCheckEnabled", { enabled: false });
    } catch (e) {
      setText(errorMessage(t, e));
    }
    await dropPermission();
    onChanged();
    setBusy(false);
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
          {state.clockCheckEnabled ? (
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
