import { describe, expect, it } from "vitest";
import {
  clipboardClearSchema,
  lockPolicySchema,
  rpcRequestSchema,
  SNAPSHOT_REASONS,
  viewModeSchema,
} from "../src/protocol";

describe("rpcRequestSchema", () => {
  it("accepts a well-formed request", () => {
    expect(rpcRequestSchema.safeParse({ type: "unlock", password: "pw" }).success).toBe(true);
  });

  it("caps the size of untrusted fields", () => {
    expect(rpcRequestSchema.safeParse({ type: "unlock", password: "x".repeat(1025) }).success).toBe(
      false,
    );
    expect(
      rpcRequestSchema.safeParse({ type: "reorder", order: new Array(10_001).fill("a") }).success,
    ).toBe(false);
  });

  it("rejects unknown request types", () => {
    expect(rpcRequestSchema.safeParse({ type: "nope" }).success).toBe(false);
  });
});

describe("shared setting schemas", () => {
  it("validates lock policies, view modes and clipboard delays", () => {
    expect(lockPolicySchema.safeParse({ kind: "timeout", minutes: 60 }).success).toBe(true);
    expect(lockPolicySchema.safeParse({ kind: "timeout", minutes: 5 }).success).toBe(false);
    expect(viewModeSchema.safeParse("hidden").success).toBe(true);
    expect(viewModeSchema.safeParse("tiny").success).toBe(false);
    expect(clipboardClearSchema.safeParse(30).success).toBe(true);
    expect(clipboardClearSchema.safeParse(45).success).toBe(false);
  });

  it("keeps the snapshot reasons in one place", () => {
    expect(SNAPSHOT_REASONS).toContain("before-recovery");
  });
});
