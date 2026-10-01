import { FakeClock, MemoryStorage } from "@otp-vault/core/testing";
import { describe, expect, it } from "vitest";
import { ATTEMPTS_KEY, delayAfter, Throttle } from "../src/background/throttle";

describe("delayAfter", () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 2000],
    [4, 4000],
    [5, 8000],
    [7, 32_000],
    [8, 60_000],
    [20, 60_000],
  ])("after %i failures waits %i ms", (failures, ms) => {
    expect(delayAfter(failures)).toBe(ms);
  });
});

describe("Throttle", () => {
  it("lets three attempts through, then makes the user wait, counting down with the clock", async () => {
    const storage = new MemoryStorage();
    const clock = new FakeClock();
    const throttle = new Throttle(storage, clock);
    for (let i = 0; i < 3; i++) {
      expect(await throttle.retryAfterMs()).toBe(0);
      await throttle.recordFailure();
    }
    expect(await throttle.retryAfterMs()).toBe(2000);
    clock.advance(1500);
    expect(await throttle.retryAfterMs()).toBe(500);
    clock.advance(500);
    expect(await throttle.retryAfterMs()).toBe(0);
  });

  it("survives a service-worker restart and resets on success", async () => {
    const storage = new MemoryStorage();
    const clock = new FakeClock();
    for (let i = 0; i < 4; i++) await new Throttle(storage, clock).recordFailure();
    expect(await new Throttle(storage, clock).retryAfterMs()).toBe(4000);
    await new Throttle(storage, clock).reset();
    expect(storage.data.has(ATTEMPTS_KEY)).toBe(false);
    expect(await new Throttle(storage, clock).retryAfterMs()).toBe(0);
  });

  it("ignores corrupt counters", async () => {
    const storage = new MemoryStorage();
    await storage.set({ [ATTEMPTS_KEY]: { failures: "many" } });
    expect(await new Throttle(storage, new FakeClock()).retryAfterMs()).toBe(0);
  });

  it("clamps elapsed time and never waits longer than delayAfter despite clock skew", async () => {
    const storage = new MemoryStorage();
    const clock = new FakeClock();
    const throttle = new Throttle(storage, clock);
    for (let i = 0; i < 3; i++) {
      await throttle.recordFailure();
    }
    expect(await throttle.retryAfterMs()).toBe(2000);
    // Simulate clock backward jump
    clock.advance(-1000 * 60 * 60 * 24); // jump back 1 day
    expect(await throttle.retryAfterMs()).toBeLessThanOrEqual(2000);
    // Simulate lastFailureAt in the future
    await storage.set({
      [ATTEMPTS_KEY]: { failures: 3, lastFailureAt: clock.now() + 1000000 },
    });
    expect(await throttle.retryAfterMs()).toBeLessThanOrEqual(2000);
  });

  it("counts a wait down from now when the stored failure lies far in the future", async () => {
    const storage = new MemoryStorage();
    const clock = new FakeClock();
    const throttle = new Throttle(storage, clock);
    await storage.set({
      [ATTEMPTS_KEY]: { failures: 3, lastFailureAt: clock.now() + 365 * 86_400_000 },
    });
    expect(await throttle.retryAfterMs()).toBeLessThanOrEqual(2000);
    clock.advance(2001);
    expect(await throttle.retryAfterMs()).toBe(0);
  });
});
