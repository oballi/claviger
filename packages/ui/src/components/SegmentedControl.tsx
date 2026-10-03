import { useRef, type KeyboardEvent } from "react";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Radiogroup pill for settings with a few options; same look as the theme and language pickers. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});

  function onKeyDown(e: KeyboardEvent) {
    if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) return;
    e.preventDefault();
    if (disabled) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
    const index = options.findIndex((o) => o.value === value);
    const next = options[(index + step + options.length) % options.length]!.value;
    buttons.current[next]?.focus();
    onChange(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`inline-flex gap-1.5 rounded-full border border-ring p-1 ${disabled ? "opacity-50" : ""}`}
    >
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              buttons.current[o.value] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            tabIndex={checked ? 0 : -1}
            onClick={() => {
              if (!checked) onChange(o.value);
            }}
            className={`h-10 cursor-pointer rounded-full border-0 px-4 font-sans text-[13px] disabled:cursor-not-allowed ${
              checked ? "bg-btn font-medium text-btn-text" : "bg-transparent text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
