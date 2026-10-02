import { describe, expect, it } from "vitest";
import { neighbourOf, reorderByDrop, swapOrder } from "@otp-vault/ui";

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
