import { MemoryStorage } from "@otp-vault/core/testing";
import { describe, expect, it } from "vitest";
import { ServiceError } from "../src/background/errors";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
} from "../src/background/settings";

describe("settings", () => {
  it("defaults to locking when the browser closes, local storage and no clock offset", async () => {
    expect(await loadSettings(new MemoryStorage())).toEqual({
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
      clockOffsetSec: 0,
      clockCheckEnabled: false,
    });
    expect(DEFAULT_SETTINGS.lockPolicy).toEqual({ kind: "browser-close" });
  });

  it("merges a patch and persists it", async () => {
    const local = new MemoryStorage();
    const saved = await saveSettings(local, { lockPolicy: { kind: "timeout", minutes: 60 } });
    expect(saved.lockPolicy).toEqual({ kind: "timeout", minutes: 60 });
    expect(saved.storageArea).toBe("local");
    expect(await loadSettings(local)).toEqual(saved);
    expect(local.data.get(SETTINGS_KEY)).toEqual(saved);
  });

  it("fills missing fields and ignores invalid ones from storage", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { storageArea: "sync", lockPolicy: { kind: "timeout", minutes: 7 } },
    });
    expect(await loadSettings(local)).toEqual({ ...DEFAULT_SETTINGS, storageArea: "sync" });
    await local.set({ [SETTINGS_KEY]: "garbage" });
    expect(await loadSettings(local)).toEqual(DEFAULT_SETTINGS);
  });

  it("rejects invalid patches", async () => {
    const local = new MemoryStorage();
    await expect(
      saveSettings(local, { lockPolicy: { kind: "timeout", minutes: 30 } as never }),
    ).rejects.toThrow();
    expect(local.data.has(SETTINGS_KEY)).toBe(false);
  });
});

describe("ServiceError", () => {
  it("carries a code and an optional retry delay", () => {
    const e = new ServiceError("throttled", "wait", 2000);
    expect(e).toBeInstanceOf(Error);
    expect(e).toMatchObject({
      name: "ServiceError",
      code: "throttled",
      retryAfterMs: 2000,
      message: "wait",
    });
    expect(new ServiceError("locked", "x").retryAfterMs).toBeUndefined();
  });
});
