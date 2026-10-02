import { describe, expect, it } from "vitest";
import { sectionsOf, sortSectionsOf } from "@claviger/ui";

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

describe("sortSectionsOf", () => {
  it("keeps empty groups and splits fixed from movable rows", () => {
    const rows = [row("1", null), row("2", "a", true), row("3", "a"), row("4", "dead")];
    const out = sortSectionsOf(rows, [g("a"), g("b")]);
    expect(
      out.map((s) => [s.group?.id ?? null, s.fixed.map((r) => r.id), s.movable.map((r) => r.id)]),
    ).toEqual([
      ["a", ["2"], ["3"]],
      ["b", [], []],
      [null, [], ["1", "4"]],
    ]);
  });
  it("with no groups returns a single headerless section", () => {
    const out = sortSectionsOf([row("1", null, true), row("2", null)], []);
    expect(out).toHaveLength(1);
    expect(out[0]!.group).toBeNull();
    expect(out[0]!.fixed.map((r) => r.id)).toEqual(["1"]);
    expect(out[0]!.movable.map((r) => r.id)).toEqual(["2"]);
  });
});
