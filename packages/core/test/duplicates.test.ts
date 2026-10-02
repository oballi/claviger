import { describe, expect, it } from "vitest";
import {
  eligibleKeepers,
  findDuplicateGroups,
  isExactDuplicate,
  pickKeeper,
} from "../src/account/duplicates";
import type { Account } from "../src/account/account";

const acct = (over: Partial<Account> & { id: string }): Account => ({
  type: "totp",
  secret: "JBSWY3DPEHPK3PXP",
  issuer: "GitHub",
  label: "me@example.test",
  algorithm: "SHA1",
  digits: 6,
  period: 30,
  counter: 0,
  domains: [],
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe("findDuplicateGroups", () => {
  it("groups identical secret and parameters as exact, ignoring secret case/spacing", () => {
    const groups = findDuplicateGroups([
      acct({ id: "a" }),
      acct({ id: "b", secret: "jbswy3dpehpk3pxp", label: "other" }),
    ]);
    expect(groups).toEqual([{ kind: "exact", ids: ["a", "b"] }]);
  });

  it("same secret with different parameters is same-secret, never exact", () => {
    const groups = findDuplicateGroups([acct({ id: "a" }), acct({ id: "b", digits: 8 })]);
    expect(groups).toEqual([{ kind: "same-secret", ids: ["a", "b"] }]);
    expect(isExactDuplicate(acct({ id: "a" }), acct({ id: "b", digits: 8 }))).toBe(false);
  });

  it("same service+label with a different secret is similar; different labels are not", () => {
    expect(
      findDuplicateGroups([
        acct({ id: "a" }),
        acct({
          id: "b",
          secret: "GEZDGNBVGY3TQOJQ",
          issuer: " github ",
          label: "ME@example.test",
        }),
      ]),
    ).toEqual([{ kind: "similar", ids: ["a", "b"] }]);
    expect(
      findDuplicateGroups([
        acct({ id: "a" }),
        acct({ id: "b", secret: "GEZDGNBVGY3TQOJQ", label: "x@y.test" }),
      ]),
    ).toEqual([]);
  });

  it("accounts with an empty issuer AND label are never similar", () => {
    expect(
      findDuplicateGroups([
        acct({ id: "a", issuer: "", label: "" }),
        acct({ id: "b", secret: "GEZDGNBVGY3TQOJQ", issuer: "", label: "" }),
      ]),
    ).toEqual([]);
  });

  it("hotp accounts with different counters are still exact", () => {
    expect(
      findDuplicateGroups([
        acct({ id: "a", type: "hotp", counter: 3 }),
        acct({ id: "b", type: "hotp", counter: 9 }),
      ]),
    ).toEqual([{ kind: "exact", ids: ["a", "b"] }]);
  });

  it("orders groups by earliest createdAt, then id", () => {
    const groups = findDuplicateGroups([
      acct({ id: "z", secret: "GEZDGNBVGY3TQOJQ", issuer: "B", label: "", createdAt: 1 }),
      acct({ id: "y", secret: "GEZDGNBVGY3TQOJQ", issuer: "C", label: "", createdAt: 2 }),
      acct({ id: "b", createdAt: 5 }),
      acct({ id: "a", createdAt: 5 }),
    ]);
    expect(groups.map((g) => g.ids)).toEqual([
      ["z", "y"],
      ["a", "b"],
    ]);
  });
});

describe("pickKeeper", () => {
  it("prefers pinned, then grouped, then most domains, then oldest", () => {
    const list = [
      acct({ id: "a", createdAt: 5 }),
      acct({ id: "b", createdAt: 9, groupId: "g" }),
      acct({ id: "c", createdAt: 1 }),
    ];
    expect(pickKeeper(list).id).toBe("b");
    expect(pickKeeper(list, new Set(["a"])).id).toBe("a");
    expect(pickKeeper([acct({ id: "a", createdAt: 5 }), acct({ id: "c", createdAt: 1 })]).id).toBe(
      "c",
    );
    expect(
      pickKeeper([acct({ id: "a", createdAt: 1 }), acct({ id: "b", domains: ["x.test"] })]).id,
    ).toBe("b");
  });

  it("hotp: only max-counter accounts are eligible, even when a lower one is pinned", () => {
    const list = [
      acct({ id: "a", type: "hotp", counter: 3 }),
      acct({ id: "b", type: "hotp", counter: 9, createdAt: 7 }),
      acct({ id: "c", type: "hotp", counter: 9, createdAt: 8 }),
    ];
    expect(eligibleKeepers(list).map((x) => x.id)).toEqual(["b", "c"]);
    expect(pickKeeper(list, new Set(["a"])).id).toBe("b");
    expect(pickKeeper(list, new Set(["c"])).id).toBe("c");
  });

  it("every account is eligible outside hotp", () => {
    const list = [acct({ id: "a" }), acct({ id: "b" })];
    expect(eligibleKeepers(list)).toHaveLength(2);
  });
});
