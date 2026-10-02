import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../components/Icon";
import { useT } from "../i18n/i18n";

export interface MenuItem {
  key: string;
  label: string;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  divider?: boolean;
  onSelect?: () => void;
  sub?: MenuItem[];
}

const ITEMS = '[role="menuitem"]:not(:disabled)';

export function RowMenu({
  label,
  items,
  triggerId,
}: {
  label: string;
  items: MenuItem[];
  /** Lets the owner find this trigger again after the row re-renders elsewhere. */
  triggerId?: string;
}) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<MenuItem[] | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    setSub(null);
    if (restoreFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const enabled = menu.current?.querySelectorAll<HTMLElement>(ITEMS);
    // In a sub-list, start on the first real choice rather than "Back".
    (sub ? (enabled?.[1] ?? enabled?.[0]) : enabled?.[0])?.focus();
  }, [open, sub]);

  useEffect(() => {
    if (!open) return;
    // The menu can extend the scrollable list; keep it visible.
    menu.current?.scrollIntoView?.({ block: "nearest" });
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) {
        setOpen(false);
        setSub(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const enabled = Array.from(menu.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);
    const at = enabled.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (e.key === "ArrowDown") next = enabled[(at + 1) % enabled.length];
    else if (e.key === "ArrowUp") next = enabled[(at <= 0 ? enabled.length : at) - 1];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    } else if (e.key === "Tab") {
      // Focus the trigger first so the default Tab continues from it instead of from a removed node.
      close(true);
      return;
    } else return;
    // Keeps the list's own arrow handling and the search Escape out of it.
    e.preventDefault();
    e.stopPropagation();
    next?.focus();
  }

  const shown: MenuItem[] = sub ? [{ key: "back", label: t("common.back") }, ...sub] : items;

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        data-menu-for={triggerId}
        onClick={() => (open ? close(true) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }
        }}
        className={`-mr-2 flex h-11 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border bg-transparent p-0 text-muted ${open ? "border-line text-text" : "border-transparent"}`}
      >
        <Icon name="more" size={18} />
      </button>
      {open ? (
        <div
          ref={menu}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="absolute top-full right-0 z-10 flex w-[236px] cursor-default flex-col rounded-[14px] border border-ring bg-bg p-1.5 shadow-lg"
        >
          {shown.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              aria-haspopup={item.sub ? "menu" : undefined}
              disabled={item.disabled}
              onClick={() => {
                if (item.key === "back") setSub(null);
                else if (item.sub) setSub(item.sub);
                else {
                  close(true);
                  item.onSelect?.();
                }
              }}
              className={`flex min-h-10 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-lg border-0 bg-transparent px-3 text-left font-sans text-[13px] hover:bg-hair focus-visible:bg-hair disabled:cursor-default disabled:opacity-40 ${item.danger ? "text-warn" : "text-text"} ${item.divider ? "mt-1 border-t border-hair pt-1" : ""}`}
            >
              {item.label}
              {item.hint ? (
                <span className="font-mono text-[11px] text-muted">{item.hint}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
