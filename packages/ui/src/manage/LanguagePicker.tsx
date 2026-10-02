import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Language } from "../i18n/locales";
import { errorMessage } from "../errors";
import { LANGUAGE_VALUES, LOCALES, useT } from "../i18n/i18n";
import { useUi } from "../platform";

/** Same shape as ThemePicker: a radiogroup that applies at once (the page re-reads state to switch). */
export function LanguagePicker({ language, onSaved }: { language: Language; onSaved: () => void }) {
  const { rpc } = useUi();
  const t = useT();
  const [current, setCurrent] = useState(language);
  const [error, setError] = useState("");
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => setCurrent(language), [language]);

  const label = (value: Language) =>
    value === "system" ? t("language.system") : LOCALES.find((l) => l.code === value)!.native;

  async function choose(next: Language) {
    if (next === current) return;
    setError("");
    const previous = current;
    setCurrent(next);
    try {
      await rpc("setLanguage", { language: next });
      onSaved();
    } catch (e) {
      setCurrent(previous);
      setError(errorMessage(t, e));
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const values = LANGUAGE_VALUES;
    const next = values[(values.indexOf(current) + step + values.length) % values.length]!;
    buttons.current[next]?.focus();
    void choose(next);
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-hair py-[22px]">
      <div id="language-label" className="text-[15px] font-medium">
        {t("language.label")}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="language-label"
        onKeyDown={onKeyDown}
        className="flex max-w-md gap-1.5 rounded-full border border-ring p-1"
      >
        {LANGUAGE_VALUES.map((value) => {
          const checked = value === current;
          return (
            <button
              key={value}
              ref={(el) => {
                buttons.current[value] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => void choose(value)}
              className={`h-10 flex-1 cursor-pointer rounded-full border-0 font-sans text-[13px] ${
                checked ? "bg-btn font-medium text-btn-text" : "bg-transparent text-text"
              }`}
            >
              {label(value)}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-xs leading-normal text-muted">{t("language.hint")}</p>
      <p role="status" className="m-0 min-h-4 text-xs text-warn">
        {error}
      </p>
    </div>
  );
}
