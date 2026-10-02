import { describe, expect, it } from "vitest";
import { dropPlacement, neighbourOf, reorderByDrop, swapOrder } from "@otp-vault/ui";

const rows = [
  { id: "p1", pinned: true },
  { id: "p2", pinned: true },
  { id: "a", pinned: false },
  { id: "b", pinned: false },
  { id: "c", pinned: false },
];

describe("reorderByDrop", () => {
  it("moves down after the target", () => {
    expect(reorderByDrop(rows, "a", "c")).toEqual(["p1", "p2", "b", "c", "a"]);
  });
  it("moves up before the target", () => {
    expect(reorderByDrop(rows, "c", "a")).toEqual(["p1", "p2", "c", "a", "b"]);
  });
  it("refuses to mix pinned and other accounts", () => {
    expect(reorderByDrop(rows, "a", "p1")).toBeNull();
  });
  it("ignores a drop on itself or an unknown id", () => {
    expect(reorderByDrop(rows, "a", "a")).toBeNull();
    expect(reorderByDrop(rows, "zz", "a")).toBeNull();
  });
});

describe("neighbourOf / swapOrder", () => {
  const list = [
    { id: "a", pinned: true },
    { id: "b", pinned: false },
    { id: "c", pinned: false },
    { id: "d", pinned: true },
  ];
  it("finds the neighbour among rows with the same pinned state", () => {
    expect(neighbourOf(list, "b", 1)?.id).toBe("c");
    expect(neighbourOf(list, "a", 1)?.id).toBe("d");
    expect(neighbourOf(list, "b", -1)).toBeUndefined();
    expect(neighbourOf(list, "zzz", 1)).toBeUndefined();
  });
  it("swaps two ids in a full order", () => {
    expect(swapOrder(["a", "x", "b", "y"], "a", "b")).toEqual(["b", "x", "a", "y"]);
    expect(swapOrder(["a", "b"], "a", "zz")).toEqual(["a", "b"]);
  });
});

describe("reorderByDrop groups", () => {
  it("refuses to reorder across groups", () => {
    const grouped = [
      { id: "a", pinned: false, groupId: "g1" },
      { id: "b", pinned: false, groupId: "g2" },
    ];
    expect(reorderByDrop(grouped, "a", "b")).toBeNull();
  });
});

describe("dropPlacement", () => {
  const r = (id: string, groupId: string | null, pinned = false) => ({ id, groupId, pinned });
  const list = [
    r("p", "g", true),
    r("a", "g"),
    r("b", "g"),
    r("c", "g"),
    r("x", null),
    r("y", null),
  ];

  it("puts a downward drop after the target and an upward drop before it", () => {
    expect(dropPlacement(list, "a", "b")).toEqual({ groupId: "g", beforeId: "c" });
    expect(dropPlacement(list, "c", "a")).toEqual({ groupId: "g", beforeId: "a" });
  });
  it("lands before the target across groups and reports the target's group", () => {
    expect(dropPlacement(list, "a", "y")).toEqual({ groupId: null, beforeId: "y" });
    expect(dropPlacement(list, "y", "b")).toEqual({ groupId: "g", beforeId: "b" });
  });
  it("refuses pinned targets, the dragged row itself and unknown ids", () => {
    expect(dropPlacement(list, "a", "p")).toBeNull();
    expect(dropPlacement(list, "p", "a")).toBeNull();
    expect(dropPlacement(list, "a", "a")).toBeNull();
    expect(dropPlacement(list, "zz", "a")).toBeNull();
    expect(dropPlacement(list, "a", "zz")).toBeNull();
  });
  it("downward onto the last row of a group appends (beforeId null)", () => {
    expect(dropPlacement(list, "a", "c")).toEqual({ groupId: "g", beforeId: null });
  });
});
