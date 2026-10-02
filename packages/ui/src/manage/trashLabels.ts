import type { TrashItemView } from "../contract/views";
import { formatDate } from "../format";
import type { Locale, Translate } from "../i18n/i18n";

/** "bugün 14:32" / "dün 14:32" / "12 Eki 2026"; relative days follow the service clock (ageDays). */
export function deletedLabel(locale: Locale, t: Translate, item: TrashItemView): string {
  if (item.ageDays > 1) return formatDate(locale, item.deletedAt);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(item.deletedAt));
  return t(item.ageDays === 1 ? "trash.yesterday" : "trash.today", { time });
}
