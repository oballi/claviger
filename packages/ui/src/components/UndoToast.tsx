import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/i18n";

/**
 * The status region stays mounted and only its content changes, so screen readers announce it
 * (a region inserted together with its text is often skipped). The timer pauses while the
 * pointer or focus is inside, so nobody races the clock to reach "Undo".
 */
export function UndoToast({
  message,
  token,
  autoFocus = false,
  onUndo,
  onDone,
  onDismiss,
  timeoutMs = 8000,
}: {
  message: string | null;
  /** Identifies the offer, so a second delete with the same text restarts timer and focus. */
  token?: string;
  autoFocus?: boolean;
  onUndo: () => void;
  onDone: () => void;
  onDismiss: () => void;
  timeoutMs?: number;
}) {
  const t = useT();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const held = hovered || focused;
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setHovered(false);
    setFocused(false);
    if (message && autoFocus) button.current?.focus();
  }, [message, token, autoFocus]);

  useEffect(() => {
    if (!message || held) return;
    const id = setTimeout(onDone, timeoutMs);
    return () => clearTimeout(id);
  }, [message, token, held, onDone, timeoutMs]);

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !message) return;
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }}
      className={
        message
          ? "absolute inset-x-4 bottom-4 flex min-h-12 items-center gap-3 rounded-[14px] bg-btn pr-2 pl-4 text-[13px] text-btn-text shadow-[0_10px_28px_rgba(0,0,0,0.45)]"
          : "sr-only"
      }
    >
      {message ? (
        <>
          <span className="min-w-0 flex-1 truncate">{message}</span>
          <button
            ref={button}
            type="button"
            onClick={onUndo}
            className="h-11 shrink-0 cursor-pointer border-0 bg-transparent px-3.5 font-sans text-[13px] font-medium text-btn-text underline decoration-1 underline-offset-[3px]"
          >
            {t("trash.undo")}
          </button>
        </>
      ) : null}
    </div>
  );
}
