import { describe, expect, it } from "vitest";
import { reorderByDrop } from "@otp-vault/ui";

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
