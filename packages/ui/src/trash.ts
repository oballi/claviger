import type { TrashItemView } from "./contract/views";
import type { Translate } from "./i18n/i18n";

export const trashName = (item: TrashItemView, t: Translate) =>
  item.issuer || item.label || t("add.unnamed");

export const leftText = (t: Translate, days: number) =>
  t(days === 1 ? "trash.leftOne" : "trash.left", { count: days });

const ageText = (t: Translate, days: number) =>
  days <= 0
    ? t("trash.age.today")
    : days === 1
      ? t("trash.age.yesterday")
      : t("trash.age.days", { count: days });

/** "omer.balli · bugün silindi · 30 gün kaldı"; the label is dropped when it is the name itself. */
export const popupMeta = (t: Translate, item: TrashItemView) =>
  [item.issuer ? item.label : "", ageText(t, item.ageDays), leftText(t, item.daysLeft)]
    .filter(Boolean)
    .join(" · ");
