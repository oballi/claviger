import { MemoryStorage } from "@claviger/core/testing";
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
      lastBackupAt: null,
      backupReminderDays: 30,
      backupReminderSince: null,
      backupReminderSnoozedUntil: null,
      viewMode: "normal",
      theme: "system",
      language: "system",
      openMode: "popup",
      popupSize: "medium",
      clipboardClearSec: 60,
      clipboardClearChosen: false,
      recoveryCodeConfirmed: true,
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

  it("loads defaults for the reveal and backup fields missing from an old object", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { storageArea: "sync", clockOffsetSec: 5, clockCheckEnabled: true },
    });
    expect(await loadSettings(local)).toMatchObject({ lastBackupAt: null, clockOffsetSec: 5 });
    await local.set({ [SETTINGS_KEY]: { revealRequiresPassword: false, lastBackupAt: 1.5 } });
    const loaded = await loadSettings(local);
    expect(loaded.lastBackupAt).toBeNull();
    expect("revealRequiresPassword" in loaded).toBe(false);
  });

  it("bounds clockOffsetSec to 12 hours on read", async () => {
    const local = new MemoryStorage();
    for (const [value, expected] of [
      [10_000_000, 0],
      [43_200, 43_200],
      [43_201, 0],
      [-43_200, -43_200],
      [-43_201, 0],
    ] as const) {
      await local.set({ [SETTINGS_KEY]: { clockOffsetSec: value } });
      expect((await loadSettings(local)).clockOffsetSec).toBe(expected);
    }
  });

  it("loads defaults for the 0.0.1 object without the new fields", async () => {
    const local = new MemoryStorage();
    await local.set({ [SETTINGS_KEY]: { storageArea: "sync", lastBackupAt: 7 } });
    expect(await loadSettings(local)).toMatchObject({
      viewMode: "normal",
      theme: "system",
      clipboardClearSec: 60,
      recoveryCodeConfirmed: true,
      storageArea: "sync",
      lastBackupAt: 7,
    });
  });

  it("falls back to system for an unknown language and keeps the other settings", async () => {
    const local = new MemoryStorage();
    await local.set({ [SETTINGS_KEY]: { language: "de", theme: "dark" } });
    expect(await loadSettings(local)).toMatchObject({ language: "system", theme: "dark" });
  });

  it("falls back per field for a bad openMode or popupSize", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { openMode: "tab", popupSize: "huge", theme: "dark" },
    });
    expect(await loadSettings(local)).toMatchObject({
      openMode: "popup",
      popupSize: "medium",
      theme: "dark",
    });
  });

  it("falls back to the default for an invalid clipboard value without touching other fields", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { clipboardClearSec: 45, viewMode: "compact", storageArea: "sync" },
    });
    expect(await loadSettings(local)).toMatchObject({
      clipboardClearSec: 60,
      viewMode: "compact",
      storageArea: "sync",
    });
  });

  it("keeps a chosen clipboard value, never included, and treats an unchosen 0 as unset", async () => {
    const local = new MemoryStorage();
    for (const [stored, expected] of [
      [{ clipboardClearSec: 0, clipboardClearChosen: true }, 0],
      [{ clipboardClearSec: 30, clipboardClearChosen: true }, 30],
      [{ clipboardClearSec: 0 }, 60],
      [{ clipboardClearSec: 0, clipboardClearChosen: false }, 60],
      [{ clipboardClearSec: 30 }, 30],
      [{ clipboardClearChosen: true }, 60],
    ] as const) {
      await local.set({ [SETTINGS_KEY]: stored });
      expect((await loadSettings(local)).clipboardClearSec).toBe(expected);
    }
    await local.set({ [SETTINGS_KEY]: { clipboardClearSec: 0, clipboardClearChosen: true } });
    await saveSettings(local, { theme: "dark" });
    expect((await loadSettings(local)).clipboardClearSec).toBe(0);
  });

  it("falls back to the default for an invalid backup reminder value without touching other fields", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { backupReminderDays: 7, backupReminderSince: "x", viewMode: "compact" },
    });
    expect(await loadSettings(local)).toMatchObject({
      backupReminderDays: 30,
      backupReminderSince: null,
      viewMode: "compact",
    });
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

  it("ignores legacy siteMemory and fillOnlyLinked and drops them on the next save", async () => {
    const local = new MemoryStorage();
    await local.set({
      [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, siteMemory: false, fillOnlyLinked: false },
    });
    const loaded = await loadSettings(local);
    expect("siteMemory" in loaded).toBe(false);
    expect("fillOnlyLinked" in loaded).toBe(false);
    await saveSettings(local, { theme: "dark" });
    const stored = (await local.get([SETTINGS_KEY]))[SETTINGS_KEY] as Record<string, unknown>;
    expect("siteMemory" in stored).toBe(false);
    expect("fillOnlyLinked" in stored).toBe(false);
  });
});
