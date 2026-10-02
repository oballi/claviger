import { describe, expect, it } from "vitest";
import { dropId, moveId } from "../../../packages/ui/src/manage/groupOrder";

describe("group order helpers", () => {
  it("moves by one and refuses at the edges", () => {
    expect(moveId(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveId(["a", "b", "c"], "a", -1)).toBeNull();
    expect(moveId(["a", "b", "c"], "c", 1)).toBeNull();
    expect(moveId(["a"], "zz", 1)).toBeNull();
  });
  it("drops before or after like the account table does", () => {
    expect(dropId(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(dropId(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(dropId(["a", "b"], "a", "a")).toBeNull();
    expect(dropId(["a", "b"], "a", "zz")).toBeNull();
  });
});
