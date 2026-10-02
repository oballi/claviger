import type { TrashItemView } from "@otp-vault/ui/views";
import { describe, expect, it } from "vitest";
import { translate } from "../../../packages/ui/src/i18n/i18n";
import { leftText, popupMeta, trashName } from "../../../packages/ui/src/trash";

const item = (over: Partial<TrashItemView> = {}): TrashItemView => ({
  id: "a",
  issuer: "Instagram",
  label: "omer.balli",
  deletedAt: 0,
  expiresAt: 0,
  ageDays: 0,
  daysLeft: 30,
  ...over,
});
const tr = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate("tr", key, vars);
const en = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>) =>
  translate("en", key, vars);

describe("trash text helpers", () => {
  it("builds the popup subtitle like the design", () => {
    expect(popupMeta(tr, item())).toBe("omer.balli · bugün silindi · 30 gün kaldı");
    expect(popupMeta(tr, item({ ageDays: 1, daysLeft: 29 }))).toContain("dün silindi");
    expect(popupMeta(tr, item({ ageDays: 26, daysLeft: 4 }))).toBe(
      "omer.balli · 26 gün önce silindi · 4 gün kaldı",
    );
  });

  it("leaves the label out when the service has no separate name, and singularises", () => {
    expect(popupMeta(tr, item({ issuer: "", label: "solo" }))).toBe("bugün silindi · 30 gün kaldı");
    expect(leftText(en, 1)).toBe("1 day left");
    expect(leftText(en, 4)).toBe("4 days left");
  });

  it("names an entry by issuer, then label, then a fallback", () => {
    expect(trashName(item(), tr)).toBe("Instagram");
    expect(trashName(item({ issuer: "" }), tr)).toBe("omer.balli");
    expect(trashName(item({ issuer: "", label: "" }), tr)).toBe("Hesap");
  });
});
