import { describe, expect, it, vi } from "vitest";
import { handleLockCommand } from "../src/background/triggers";
import { VaultService } from "../src/background/vaultService";
import { memoryPlatform } from "./helpers/platform";
import { unlockedService } from "./helpers/service";

describe("lock-vault command", () => {
  it("locks, flashes LOCK and touches nothing else (no popup, no launcher)", async () => {
    const calls: string[] = [];
    const service = {
      lock: vi.fn(async () => void calls.push("lock")),
      flashBadge: vi.fn(async (t: string) => void calls.push(`badge:${t}`)),
      // Any other member access fails the test, so openPopup/launcher use would be caught.
    };
    const guarded = new Proxy(service, {
      get(target, key) {
        if (key in target) return target[key as keyof typeof target];
        throw new Error(`unexpected access: ${String(key)}`);
      },
    });
    await handleLockCommand(guarded);
    expect(calls).toEqual(["lock", "badge:LOCK"]);
  });

  it("does not throw without a vault, when already locked, or when unlocked", async () => {
    const empty = new VaultService(memoryPlatform());
    await expect(handleLockCommand(empty)).resolves.toBeUndefined();
    expect((await empty.getState()).status).toBe("no-vault");

    const { service } = await unlockedService();
    await handleLockCommand(service);
    expect((await service.getState()).status).toBe("locked");
    await expect(handleLockCommand(service)).resolves.toBeUndefined();
    expect((await service.getState()).status).toBe("locked");
  });
});
