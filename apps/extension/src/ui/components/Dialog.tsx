import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useT } from "../i18n/i18n";
import { Icon } from "./Icon";

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: traps Tab inside, closes on Escape, and returns focus to the opener. */
export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = panel.current;
    if (node && !node.contains(document.activeElement)) {
      node.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }
    return () => opener?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-start justify-center overflow-auto bg-black/40 p-6">
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="mt-[8vh] flex w-full max-w-[520px] flex-col gap-6 bg-bg p-8 text-text"
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={titleId} className="m-0 text-2xl font-medium tracking-tight">
            {title}
          </h2>
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={onClose}
            className="-mt-2 -mr-3 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-text hover:bg-hair"
          >
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
