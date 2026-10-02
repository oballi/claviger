import { useId, type ReactNode } from "react";
import { Icon } from "../components/Icon";

export function GroupSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const listId = useId();
  return (
    <section aria-label={`${title} \u00b7 ${count}`}>
      <h2 className="m-0 text-[11px] font-normal">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={onToggle}
          className={`flex min-h-11 w-full cursor-pointer items-center gap-2 border-0 bg-transparent p-0 pt-5 ${open ? "" : "border-b border-hair"} text-left font-sans text-[11px] text-muted`}
        >
          <Icon name={open ? "chevron-down" : "next"} size={12} />
          <span className="flex-1">{title}</span>
          <span className="font-mono">{count}</span>
        </button>
      </h2>
      {open ? (
        <ul id={listId} className="m-0 list-none p-0">
          {children}
        </ul>
      ) : null}
    </section>
  );
}
