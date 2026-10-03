import type { GroupView } from "../contract/views";
import { useT } from "../i18n/i18n";

export function GroupSelect({
  id,
  value,
  groups,
  onChange,
  className = "",
}: {
  id: string;
  value: string;
  groups: readonly GroupView[];
  onChange: (groupId: string) => void;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-xs text-muted">
        {t("edit.group")}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="ov-select h-11 rounded-full border border-line bg-bg pl-3.5 font-sans text-[13px] text-text"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
        <option value="">{t("group.none")}</option>
      </select>
    </div>
  );
}
