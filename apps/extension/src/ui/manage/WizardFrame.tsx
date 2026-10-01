import type { ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useT, type MessageKey } from "../i18n/i18n";

const STEPS: MessageKey[] = [
  "setup.step.password",
  "setup.step.recovery",
  "setup.step.lock",
  "setup.step.storage",
  "setup.step.account",
];

/** Setup layout: step sidebar, the current step, and a bottom bar for navigation (design Setup*). */
export function WizardFrame({
  step,
  children,
  footer,
}: {
  step: number;
  children: ReactNode;
  footer: ReactNode;
}) {
  const t = useT();
  return (
    <div className="flex min-h-screen flex-col bg-bg font-sans text-text">
      <div className="flex flex-1 flex-wrap">
        <nav
          aria-label={t("setup.stepsLabel")}
          className="flex w-full flex-col gap-10 border-hair px-10 pt-9 pb-6 md:w-[280px] md:border-r"
        >
          <div className="font-mono text-[13px] tracking-wide">{t("app.name")}</div>
          <ol className="m-0 flex list-none flex-col gap-1 p-0">
            {STEPS.map((key, i) => {
              const current = i === step;
              return (
                <li
                  key={key}
                  aria-current={current ? "step" : undefined}
                  className={`flex min-h-11 items-center gap-3.5 text-sm ${i <= step ? "text-text" : "text-muted"}`}
                >
                  <span className="font-mono text-[11px]">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1">{t(key)}</span>
                  {i < step ? (
                    <span role="img" aria-label={t("setup.step.done")} className="flex">
                      <Icon name="check" size={14} />
                    </span>
                  ) : null}
                  {current ? (
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-text" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </nav>
        <main className="flex max-w-[720px] flex-[1_1_480px] flex-col gap-10 px-[clamp(20px,6vw,96px)] pt-[72px] pb-10">
          <div className="font-mono text-xs text-muted">
            {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
          </div>
          {children}
        </main>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-hair px-10 py-4">
        {footer}
      </div>
    </div>
  );
}
