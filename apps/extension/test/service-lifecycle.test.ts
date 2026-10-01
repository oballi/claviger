import { toBase64, Vault } from "@otp-vault/core";
import { describe, expect, it, vi } from "vitest";
import { PERSISTED_KEY, SESSION_KEY } from "../src/background/keyCache";
import { saveSettings } from "../src/background/settings";
import { AUTOLOCK_ALARM, VaultService } from "../src/background/vaultService";
import { memoryPlatform, restartBrowser } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const setupOpts = {
  createRecoveryCode: false,
  lockPolicy: { kind: "browser-close" } as const,
  storageArea: "local" as const,
};

describe("setup", () => {
  it("reports no vault before setup", async () => {
    expect(await new VaultService(memoryPlatform()).getState()).toEqual({
      status: "no-vault",
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
      hasRecoveryCode: null,
      retryAfterMs: 0,
      clockOffsetSec: 0,
      clockCheckEnabled: false,
    });
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const service = new VaultService(memoryPlatform());
    expect(await codeOf(service.setup({ ...setupOpts, password: "short" }))).toBe(
      "invalid-request",
    );
  });

  it("creates an unlocked vault with a recovery code", async () => {
    const { p, service, recoveryCode } = await unlockedService();
    expect(recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    expect(await service.getState()).toMatchObject({ status: "unlocked", hasRecoveryCode: true });
    expect(p.session.data.has(SESSION_KEY)).toBe(true);
    expect(p.local.data.has(PERSISTED_KEY)).toBe(false);
    expect(await Vault.exists(p.local)).toBe(true);
  });

  it("creates the vault in sync when asked, keeping every key out of sync", async () => {
    const p = memoryPlatform();
    const service = new VaultService(p);
    await service.setup({
      ...setupOpts,
      password: PASSWORD,
      lockPolicy: { kind: "never" },
      storageArea: "sync",
    });
    expect(await Vault.exists(p.sync)).toBe(true);
    expect(await Vault.exists(p.local)).toBe(false);
    expect([...p.sync.data.keys()].every((k) => k.startsWith("vault:"))).toBe(true);
    expect(p.local.data.has(PERSISTED_KEY)).toBe(true);
    expect(await service.getState()).toMatchObject({
      storageArea: "sync",
      lockPolicy: { kind: "never" },
    });
  });

  it("refuses a second setup", async () => {
    const { service } = await unlockedService();
    expect(await codeOf(service.setup({ ...setupOpts, password: PASSWORD }))).toBe(
      "already-set-up",
    );
  });
});

describe("unlocking", () => {
  it("locks and unlocks with the password", async () => {
    const { service } = await unlockedService();
    await service.lock();
    expect((await service.getState()).status).toBe("locked");
    await service.unlock(PASSWORD);
    expect((await service.getState()).status).toBe("unlocked");
  });

  it("throttles after three wrong passwords without running the KDF", async () => {
    const { p, service } = await unlockedService();
    await service.lock();
    for (let i = 0; i < 2; i++)
      expect(await codeOf(service.unlock("wrong password"))).toBe("wrong-password");
    await expect(service.unlock("wrong password")).rejects.toMatchObject({
      code: "wrong-password",
      retryAfterMs: 2000,
    });
    const spy = vi.spyOn(Vault, "unlockWithPassword");
    await expect(service.unlock(PASSWORD)).rejects.toMatchObject({
      code: "throttled",
      retryAfterMs: 2000,
    });
    expect(spy).not.toHaveBeenCalled();
    expect((await new VaultService(p).getState()).retryAfterMs).toBe(2000);
    p.clock.advance(2000);
    await service.unlock(PASSWORD);
    expect((await service.getState()).retryAfterMs).toBe(0);
    spy.mockRestore();
  });

  it("fails cleanly when there is no vault", async () => {
    const service = new VaultService(memoryPlatform());
    expect(await codeOf(service.unlock(PASSWORD))).toBe("no-vault");
    expect(
      await codeOf(service.unlockWithRecovery("0000-0000-0000-0000-0000-0000-0000-0000", PASSWORD)),
    ).toBe("no-vault");
  });

  it("unlocks with the recovery code, sets a new password and rotates the code", async () => {
    const { service, recoveryCode } = await unlockedService();
    await service.lock();
    expect(await codeOf(service.unlockWithRecovery(recoveryCode!, "short"))).toBe(
      "invalid-request",
    );
    const { recoveryCode: next } = await service.unlockWithRecovery(
      recoveryCode!,
      "brand new password",
    );
    expect(next).not.toBe(recoveryCode);
    expect((await service.getState()).status).toBe("unlocked");
    await service.lock();
    expect(await codeOf(service.unlock(PASSWORD))).toBe("wrong-password");
    await service.unlock("brand new password");
  });

  it("counts wrong recovery codes towards the throttle", async () => {
    const { p, service } = await unlockedService();
    await service.lock();
    for (let i = 0; i < 3; i++) {
      expect(
        await codeOf(
          service.unlockWithRecovery(
            "0000-0000-0000-0000-0000-0000-0000-0000",
            "brand new password",
          ),
        ),
      ).toBe("invalid-recovery-code");
    }
    expect((await service.getState()).retryAfterMs).toBe(2000);
    expect(await codeOf(service.unlock(PASSWORD))).toBe("throttled");
    p.clock.advance(2000);
    await service.unlock(PASSWORD);
  });

  it("reports a corrupt vault header as a status instead of an error", async () => {
    const { p } = await unlockedService();
    p.local.data.set("vault:header", { format: 1 });
    expect((await new VaultService(p).getState()).status).toBe("corrupt");
  });

  it("reports a vault written by a newer version", async () => {
    const { p, service } = await unlockedService();
    const header = p.local.data.get("vault:header") as Record<string, unknown>;
    p.local.data.set("vault:header", { ...header, format: 2 });
    expect((await new VaultService(p).getState()).status).toBe("unsupported");
    await service.lock();
    expect(await codeOf(service.unlock(PASSWORD))).toBe("unsupported-format");
  });
  it("serializes parallel unlock attempts so the throttle cannot be raced", async () => {
    const { p, service } = await unlockedService();
    await service.lock();
    const results = await Promise.allSettled(
      [1, 2, 3, 4].map(() => service.unlock("wrong password")),
    );
    const codes = results.map((r) =>
      r.status === "rejected" ? (r.reason as { code: string }).code : "ok",
    );
    expect(codes.filter((c) => c === "wrong-password")).toHaveLength(3);
    expect(codes.filter((c) => c === "throttled")).toHaveLength(1);
    expect((await new VaultService(p).getState()).retryAfterMs).toBe(2000);
  });
});

describe("restarts", () => {
  it("restores the unlocked vault after a service-worker restart", async () => {
    const { p } = await unlockedService();
    expect((await new VaultService(p).getState()).status).toBe("unlocked");
  });

  it("is locked after a browser restart", async () => {
    const { p } = await unlockedService();
    expect((await new VaultService(restartBrowser(p)).getState()).status).toBe("locked");
  });

  it("stays unlocked across browser restarts with the never policy, unless locked by hand", async () => {
    const { p } = await unlockedService(memoryPlatform(), { kind: "never" });
    const second = restartBrowser(p);
    const service = new VaultService(second);
    expect((await service.getState()).status).toBe("unlocked");
    await service.lock();
    expect((await new VaultService(second).getState()).status).toBe("locked");
    expect((await new VaultService(restartBrowser(second)).getState()).status).toBe("unlocked");
  });

  it("forgets a cached key that does not open the vault", async () => {
    const { p } = await unlockedService();
    p.session.data.set(SESSION_KEY, toBase64(p.random.bytes(32)));
    expect((await new VaultService(p).getState()).status).toBe("locked");
    expect(p.session.data.has(SESSION_KEY)).toBe(false);
  });

  it("finds the vault in local storage after an interrupted move back from sync", async () => {
    const { p } = await unlockedService();
    await saveSettings(p.local, { storageArea: "sync" });
    expect(await new VaultService(p).getState()).toMatchObject({
      status: "unlocked",
      storageArea: "local",
    });
  });

  it("adopts a vault that arrived through browser sync on a new device", async () => {
    const p = memoryPlatform();
    await Vault.create(
      { storage: p.sync, random: p.random, clock: p.clock, kdf: p.kdf },
      { password: PASSWORD, createRecoveryCode: false },
    );
    const service = new VaultService(p);
    expect(await service.getState()).toMatchObject({ status: "locked", storageArea: "sync" });
    await service.unlock(PASSWORD);
    expect((await service.getState()).status).toBe("unlocked");
  });
});

describe("lock policies", () => {
  it("schedules the autolock alarm for the timeout policy and locks when it fires", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), {
      kind: "timeout",
      minutes: 15,
    });
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(p.clock.now() + 15 * 60_000);
    await service.handleAlarm("something-else");
    expect((await service.getState()).status).toBe("unlocked");
    await service.handleAlarm(AUTOLOCK_ALARM);
    expect((await service.getState()).status).toBe("locked");
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(false);
  });

  it("does not schedule an alarm for other policies", async () => {
    const { p } = await unlockedService(memoryPlatform(), { kind: "browser-close" });
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(false);
  });

  it("locks on screen lock only for the screen-lock policy", async () => {
    const plain = await unlockedService(memoryPlatform(), { kind: "browser-close" });
    await plain.service.handleIdleState("locked");
    expect((await plain.service.getState()).status).toBe("unlocked");

    const screen = await unlockedService(memoryPlatform(), {
      kind: "browser-close-or-screen-lock",
    });
    await screen.service.handleIdleState("idle");
    await screen.service.handleIdleState("active");
    expect((await screen.service.getState()).status).toBe("unlocked");
    await screen.service.handleIdleState("idle", { idleMeansLocked: true });
    expect((await screen.service.getState()).status).toBe("locked");
    await screen.service.unlock(PASSWORD);
    await screen.service.handleIdleState("locked");
    expect((await screen.service.getState()).status).toBe("locked");
  });
});
