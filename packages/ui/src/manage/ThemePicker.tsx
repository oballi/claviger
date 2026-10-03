import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Theme } from "../contract/views";
import { errorMessage } from "../errors";
import { useT } from "../i18n/i18n";
import { useUi } from "../platform";
import { applyTheme } from "../theme";

const THEMES: Theme[] = ["system", "light", "dark"];

/** Theme picker: a three-way radiogroup; the choice is applied at once and stored. */
export function ThemePicker({ theme, onSaved }: { theme: Theme; onSaved: () => void }) {
  const { rpc } = useUi();
  const t = useT();
  const [current, setCurrent] = useState(theme);
  const [error, setError] = useState("");
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => setCurrent(theme), [theme]);

  async function choose(next: Theme) {
    if (next === current) return;
    setError("");
    const previous = current;
    setCurrent(next);
    applyTheme(next);
    try {
      await rpc("setTheme", { theme: next });
      onSaved();
    } catch (e) {
      setCurrent(previous);
      applyTheme(previous);
      setError(errorMessage(t, e));
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    const next = THEMES[(THEMES.indexOf(current) + step + THEMES.length) % THEMES.length]!;
    buttons.current[next]?.focus();
    void choose(next);
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-hair py-[22px]">
      <div id="theme-label" className="text-[15px] font-medium">
        {t("theme.label")}
      </div>
      <div
        role="radiogroup"
        aria-labelledby="theme-label"
        onKeyDown={onKeyDown}
        className="flex max-w-md gap-1.5 rounded-full border border-ring p-1"
      >
        {THEMES.map((value) => {
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
              {t(`theme.${value}`)}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-xs leading-normal text-muted">{t("theme.hint")}</p>
      <p role="status" className="m-0 min-h-4 text-xs text-warn">
        {error}
      </p>
    </div>
  );
}
