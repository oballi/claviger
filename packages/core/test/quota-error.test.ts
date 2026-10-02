import { describe, expect, it } from "vitest";
import { isQuotaError } from "../src";

describe("isQuotaError", () => {
  it("matches browser quota failures", () => {
    expect(isQuotaError(new Error("QUOTA_BYTES quota exceeded"))).toBe(true);
    expect(isQuotaError(new Error("Resource::kQuotaBytes quota exceeded"))).toBe(true);
    expect(
      isQuotaError({ name: "QuotaExceededError", message: "exceeded its quota limitations" }),
    ).toBe(true);
    const named = new Error("x");
    named.name = "QuotaExceededError";
    expect(isQuotaError(named)).toBe(true);
  });
  it("ignores write-rate limits and unrelated errors", () => {
    expect(isQuotaError(new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded"))).toBe(false);
    expect(isQuotaError(new Error("boom"))).toBe(false);
    expect(isQuotaError("quota exceeded")).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });
});
