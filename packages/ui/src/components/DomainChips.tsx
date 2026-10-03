import { useT } from "../i18n/i18n";

/** Linked sites as removable chips; shared by the popup and manage edit screens. */
export function DomainChips({
  domains,
  onRemove,
}: {
  domains: readonly string[];
  onRemove: (domain: string) => void;
}) {
  const t = useT();
  if (domains.length === 0) {
    return <span className="text-xs text-muted opacity-70">{t("edit.noSites")}</span>;
  }
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {domains.map((d) => (
        <li
          key={d}
          className="flex h-[30px] items-center gap-1.5 rounded-full border border-hair py-0 pr-1.5 pl-3 font-mono text-xs"
        >
          {d}
          <button
            type="button"
            aria-label={t("edit.removeSite", { domain: d })}
            onClick={() => onRemove(d)}
            className="relative h-[22px] w-[22px] cursor-pointer rounded-full border-0 bg-transparent p-0 text-muted before:absolute before:top-1/2 before:left-1/2 before:size-8 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']"
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}
