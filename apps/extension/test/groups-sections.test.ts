import { describe, expect, it } from "vitest";
import { sectionsOf } from "@otp-vault/ui";

const g = (id: string) => ({ id, name: id.toUpperCase() });
const row = (id: string, groupId: string | null, pinned = false) => ({ id, groupId, pinned });

describe("sectionsOf", () => {
  it("orders groups, then ungrouped; pinned first; skips empty sections", () => {
    const rows = [
      row("1", null),
      row("2", "b"),
      row("3", "a"),
      row("4", "a", true),
      row("5", "dead"),
    ];
    const out = sectionsOf(rows, [g("a"), g("b"), g("c")]);
    expect(out.map((s) => [s.group?.id ?? null, s.rows.map((r) => r.id)])).toEqual([
      ["a", ["4", "3"]],
      ["b", ["2"]],
      [null, ["1", "5"]],
    ]);
  });
});
