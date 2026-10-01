import { useEffect } from "react";
import { Icon } from "./Icon";

/**
 * The live region stays mounted and only its text changes, so screen readers announce every
 * message (a region inserted together with its text is often skipped).
 */
export function Toast({
  message,
  onDone,
  timeoutMs = 2000,
}: {
  message: string | null;
  onDone: () => void;
  timeoutMs?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, timeoutMs);
    return () => clearTimeout(id);
  }, [message, onDone, timeoutMs]);
  return (
    <div
      role="status"
      className={`absolute bottom-[18px] left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-btn px-4 py-2.5 text-xs whitespace-nowrap text-btn-text ${message ? "" : "sr-only"}`}
    >
      {message ? <Icon name="check" size={14} /> : null}
      <span>{message ?? ""}</span>
    </div>
  );
}
