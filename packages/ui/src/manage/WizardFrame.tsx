import { useEffect, type ReactNode } from "react";
import { Icon } from "../components/Icon";
import { useT, type MessageKey } from "../i18n/i18n";

const STEPS: MessageKey[] = [
  "setup.step.password",
  "setup.step.recovery",
  "setup.step.lock",
  "setup.step.storage",
  "setup.step.account",
];

/** Setup layout: step sidebar, the current step, and an in-card action row (design Setup*). */
export function WizardFrame({
  step,
  children,
  footer,
}: {
  step: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const t = useT();
  useEffect(() => {
    // keeps focused fields from landing under the sticky action row
    const root = document.documentElement;
    root.style.scrollPaddingBottom = "160px";
    return () => {
      root.style.scrollPaddingBottom = "";
    };
  }, []);
  return (
    <div className="flex min-h-screen items-start justify-center bg-bg font-sans text-text md:items-center md:px-6 md:py-10">
      {/* zoom scales the whole card (type, rail, spacing) proportionally on large screens without touching shared components elsewhere */}
      <div className="flex w-full max-w-[960px] flex-col border-hair md:flex-row md:rounded-[20px] md:border [@media(min-width:1536px)_and_(min-height:900px)]:[zoom:1.3]">
        <nav
          aria-label={t("setup.stepsLabel")}
          className="flex w-full shrink-0 flex-col gap-10 border-hair px-[clamp(20px,6vw,48px)] pt-9 pb-6 md:w-[240px] md:border-r md:px-7 md:py-8"
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
        <main
          className={`flex min-w-0 flex-1 flex-col gap-10 px-[clamp(20px,6vw,48px)] pt-10 ${footer ? "pb-0" : "pb-8"}`}
        >
          <div className="flex max-w-[560px] flex-col gap-10">
            <div className="font-mono text-xs text-muted">
              {String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}
            </div>
            {children}
          </div>
          {footer ? (
            <div className="sticky bottom-0 -mt-10 bg-bg pt-10 pb-8">
              <div className="flex items-center justify-between gap-4 border-t border-hair pt-5">
                {footer}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
