import type { AccountView, GroupView } from "../contract/views";
import { useT } from "../i18n/i18n";

export type GroupFilter = "all" | "none" | string;

const chip = "h-[34px] cursor-pointer rounded-full border px-3.5 font-sans text-xs";

export function GroupChips({
  groups,
  accounts,
  value,
  onChange,
  onCreate,
}: {
  groups: readonly GroupView[];
  accounts: readonly AccountView[];
  value: GroupFilter;
  onChange: (v: GroupFilter) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const known = new Set(groups.map((g) => g.id));
  const count = (id: string) => accounts.filter((a) => a.groupId === id).length;
  const none = accounts.filter((a) => !a.groupId || !known.has(a.groupId)).length;
  const option = (key: GroupFilter, text: string) => (
    <button
      key={key}
      type="button"
      aria-pressed={value === key}
      onClick={() => onChange(key)}
      className={`${chip} ${value === key ? "border-btn bg-btn font-medium text-btn-text" : "border-line bg-transparent text-text"}`}
    >
      {text}
    </button>
  );
  return (
    <div role="group" aria-label={t("groups.filter")} className="flex flex-wrap items-center gap-2">
      {option("all", `${t("groups.all")} \u00b7 ${accounts.length}`)}
      {groups.map((g) => option(g.id, `${g.name} \u00b7 ${count(g.id)}`))}
      {groups.length > 0 ? option("none", `${t("group.none")} \u00b7 ${none}`) : null}
      <button
        type="button"
        onClick={onCreate}
        className={`${chip} border-dashed border-line bg-transparent text-muted`}
      >
        {t("group.new")}
      </button>
    </div>
  );
}
