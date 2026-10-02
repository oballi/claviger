import { useId, type ReactNode } from "react";
import type { LockPolicy } from "../../background/settings";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";

const MINUTES = [15, 60, 240] as const;

function Option({
  checked,
  onSelect,
  title,
  badge,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  title: string;
  badge?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-4 border-t border-hair py-4">
      <input
        id={id}
        type="radio"
        name="lock-policy"
        checked={checked}
        onChange={onSelect}
        aria-describedby={`${id}-hint`}
        className="mt-1 h-4 w-4 accent-[var(--ov-text)]"
      />
      <div className="flex flex-1 flex-col gap-1">
        <label
          htmlFor={id}
          className="flex min-h-11 cursor-pointer items-center gap-2 text-[15px] font-medium"
        >
          {title}
          {badge ? (
            <span className="rounded-full border border-line px-[7px] py-px font-mono text-[10px] font-normal text-muted">
              {badge}
            </span>
          ) : null}
        </label>
        <div id={`${id}-hint`}>{children}</div>
      </div>
    </div>
  );
}

/** The four lock policies of spec §5.4 as radio rows (setup step 3). */
export function LockPolicyOptions({
  value,
  onChange,
}: {
  value: LockPolicy;
  onChange: (policy: LockPolicy) => void;
}) {
  const t = useT();
  const { reportsScreenLock } = useUi();
  const hint = "text-[13px] leading-normal text-muted";
  return (
    <fieldset className="m-0 flex flex-col border-0 border-b border-hair p-0">
      <legend className="sr-only">{t("picker.legend")}</legend>
      <Option
        checked={value.kind === "browser-close"}
        onSelect={() => onChange({ kind: "browser-close" })}
        title={t("policy.browser-close")}
        badge={t("common.recommended")}
      >
        <span className={hint}>{t("picker.browserClose.hint")}</span>
      </Option>
      <Option
        checked={value.kind === "browser-close-or-screen-lock"}
        onSelect={() => onChange({ kind: "browser-close-or-screen-lock" })}
        title={t("policy.browser-close-or-screen-lock")}
      >
        <span className={hint}>
          {reportsScreenLock ? t("picker.screenLock.hint") : t("picker.screenLock.firefox")}
        </span>
      </Option>
      <Option
        checked={value.kind === "timeout"}
        onSelect={() =>
          onChange({ kind: "timeout", minutes: value.kind === "timeout" ? value.minutes : 15 })
        }
        title={t("picker.timeout")}
      >
        <span
          role="radiogroup"
          aria-label={t("picker.timeoutLegend")}
          className="flex flex-wrap gap-2 pt-1"
        >
          {MINUTES.map((minutes) => {
            const active = value.kind === "timeout" && value.minutes === minutes;
            return (
              <label
                key={minutes}
                className={`flex min-h-11 cursor-pointer items-center rounded-full border px-4 font-mono text-xs ${active ? "border-text text-text" : "border-line text-muted"}`}
              >
                <input
                  type="radio"
                  name="lock-minutes"
                  className="sr-only"
                  checked={active}
                  onChange={() => onChange({ kind: "timeout", minutes })}
                />
                {t(`picker.minutes.${minutes}`)}
              </label>
            );
          })}
        </span>
      </Option>
      <Option
        checked={value.kind === "never"}
        onSelect={() => onChange({ kind: "never" })}
        title={t("policy.never")}
      >
        <span className={hint}>
          <span className="text-warn">{t("picker.never.warning")}</span> {t("picker.never.hint")}
        </span>
      </Option>
    </fieldset>
  );
}
