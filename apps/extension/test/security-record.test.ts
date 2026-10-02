import { describe, expect, it } from "vitest";
import type { LockPolicy } from "../src/background/settings";
import { VaultService } from "../src/background/vaultService";
import { memoryPlatform, restartBrowser, type TestPlatform } from "./helpers/platform";
import { codeOf, PASSWORD } from "./helpers/service";

const PERSISTED = "lock:persistedKey";
const SESSION = "lock:sessionKey";
const SEAL = "lock:policy";
const URI = "otpauth://totp/Bank:me?secret=JBSWY3DPEHPK3PXP&issuer=Bank";

const patchSettings = async (p: TestPlatform, patch: Record<string, unknown>) => {
  const settings = (await p.local.get(["settings"])).settings as Record<string, unknown>;
  await p.local.set({ settings: { ...settings, ...patch } });
};

const setupOnly = async (lockPolicy: LockPolicy = { kind: "browser-close" }) => {
  const p = memoryPlatform();
  const s = new VaultService(p);
  await s.setup({
    password: PASSWORD,
    createRecoveryCode: false,
    lockPolicy,
    storageArea: "local",
  });
  await s.addAccount({ uri: URI });
  return { p, s };
};

const lockedVault = async (lockPolicy: LockPolicy = { kind: "browser-close" }) => {
  const { p, s } = await setupOnly(lockPolicy);
  await s.lock();
  return p;
};

const rejectLockPolicyWrites = (p: TestPlatform) => {
  const original = p.local.set.bind(p.local);
  p.local.set = async (items: Record<string, unknown>) => {
    if (SEAL in items) throw new Error("QUOTA_BYTES quota exceeded");
    return original(items);
  };
};

describe("device security record (H1)", () => {
  it("a storage writer cannot make unlock persist the DEK (probe-lockpolicy)", async () => {
    const p = await lockedVault();
    await patchSettings(p, { lockPolicy: { kind: "never" } });
    await new VaultService(restartBrowser(p)).unlock(PASSWORD);
    expect(p.local.data.has(PERSISTED)).toBe(false);
  });

  it("the probe attack cannot recover the secret from storage.local", async () => {
    const p = await lockedVault();
    await patchSettings(p, { lockPolicy: { kind: "never" } });
    const p2 = restartBrowser(p);
    await new VaultService(p2).unlock(PASSWORD);
    const leaked = (await p2.local.get())[PERSISTED];
    expect(leaked).toBeUndefined();
    const everything = JSON.stringify([...p2.local.data.entries()]);
    expect(everything).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it.each(["deleted", "corrupted"])("same attack with the sealed record %s", async (how) => {
    const p = await lockedVault({ kind: "never" });
    if (how === "deleted") p.local.data.delete(SEAL);
    else p.local.data.set(SEAL, { ...(p.local.data.get(SEAL) as object), ct: "AAAA" });
    p.local.data.delete(PERSISTED);
    await patchSettings(p, { lockPolicy: { kind: "never" } });
    await new VaultService(restartBrowser(p)).unlock(PASSWORD);
    expect(p.local.data.has(PERSISTED)).toBe(false);
  });

  it("honours a genuinely sealed never policy across a restart", async () => {
    const p = memoryPlatform();
    const s = new VaultService(p);
    await s.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    const { token } = await s.reauth(PASSWORD);
    await s.setLockPolicy(token, { kind: "never" });
    expect(typeof p.local.data.get(PERSISTED)).toBe("string");
    expect((await new VaultService(restartBrowser(p)).getState()).status).toBe("unlocked");
  });

  it("drops a persisted key when the sealed policy is not never (cache load)", async () => {
    const { p, s } = await setupOnly();
    const key = p.session.data.get(SESSION);
    expect(typeof key).toBe("string");
    await s.lock();
    p.local.data.set(PERSISTED, key);
    const state = await new VaultService(restartBrowser(p)).getState();
    expect(state.status).toBe("locked");
    expect(p.local.data.has(PERSISTED)).toBe(false);
  });

  it("a service-worker restart with a sealed never policy stays unlocked and keeps the key", async () => {
    const { p } = await setupOnly({ kind: "never" });
    expect((await new VaultService(p).getState()).status).toBe("unlocked");
    expect(p.local.data.has(PERSISTED)).toBe(true);
  });

  it("a service-worker restart with the seal deleted stays unlocked but forgets the persisted key", async () => {
    const { p } = await setupOnly({ kind: "never" });
    p.local.data.delete(SEAL);
    const s = new VaultService(p);
    const state = await s.getState();
    expect(state.status).toBe("unlocked");
    expect(state.lockPolicy).toEqual({ kind: "browser-close" });
    expect(p.local.data.has(PERSISTED)).toBe(false);
  });

  it("ignores a plaintext revealRequiresPassword=false", async () => {
    const p = await lockedVault();
    const s = new VaultService(p);
    await s.unlock(PASSWORD);
    await patchSettings(p, { revealRequiresPassword: false });
    const id = (await s.listAccounts()).accounts[0]!.id;
    expect(await codeOf(s.revealSecret(undefined, id))).toBe("invalid-token");
    expect((await s.getState()).revealRequiresPassword).toBe(true);
  });

  it("honours a sealed reveal=false and keeps the lock policy when re-sealing", async () => {
    const p = await lockedVault({ kind: "timeout", minutes: 15 });
    const s = new VaultService(p);
    await s.unlock(PASSWORD);
    const { token } = await s.reauth(PASSWORD);
    await s.setRevealRequiresPassword(token, false);
    const id = (await s.listAccounts()).accounts[0]!.id;
    await expect(s.revealSecret(undefined, id)).resolves.toHaveProperty("uri");
    expect((await s.getState()).lockPolicy).toEqual({ kind: "timeout", minutes: 15 });
    const s2 = new VaultService(restartBrowser(p));
    await s2.unlock(PASSWORD);
    await expect(s2.revealSecret(undefined, id)).resolves.toHaveProperty("uri");
  });

  it("legacy upgrade: no seal keeps timeout, resets never and reveal, then seals", async () => {
    for (const [legacy, expected] of [
      [
        { kind: "timeout", minutes: 15 },
        { kind: "timeout", minutes: 15 },
      ],
      [{ kind: "never" }, { kind: "browser-close" }],
    ] as const) {
      const p = await lockedVault();
      p.local.data.delete(SEAL);
      await patchSettings(p, { lockPolicy: legacy, revealRequiresPassword: false });
      const s = new VaultService(restartBrowser(p));
      await s.unlock(PASSWORD);
      const state = await s.getState();
      expect(state.lockPolicy).toEqual(expected);
      expect(state.revealRequiresPassword).toBe(true);
      expect(p.local.data.has(SEAL)).toBe(true);
      expect(p.local.data.has(PERSISTED)).toBe(false);
    }
  });

  it("rejects a sealed record copied from another vault", async () => {
    const a = await lockedVault({ kind: "never" });
    const sealedA = a.local.data.get(SEAL);
    const b = await lockedVault();
    b.local.data.set(SEAL, sealedA);
    await new VaultService(restartBrowser(b)).unlock(PASSWORD);
    expect(b.local.data.has(PERSISTED)).toBe(false);
  });

  it("deleteVault removes the record; snapshots do not carry it", async () => {
    const p = await lockedVault();
    const s = new VaultService(restartBrowser(p));
    await s.unlock(PASSWORD);
    await s.listSnapshots();
    const snapshotKeys = [...p.local.data.keys()].filter((k) => k.startsWith("snapshot:"));
    expect(snapshotKeys.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshotKeys.map((k) => p.local.data.get(k)))).not.toContain(
      "lock:policy",
    );
    const { token } = await s.reauth(PASSWORD);
    await s.deleteVault(token);
    expect(p.local.data.has(SEAL)).toBe(false);
  });

  it("moving the vault to sync keeps the seal in local and the timeout across a restart", async () => {
    const p = await lockedVault({ kind: "timeout", minutes: 15 });
    const s = new VaultService(p);
    await s.unlock(PASSWORD);
    await s.setStorageArea((await s.reauth(PASSWORD)).token, "sync");
    expect(p.local.data.has(SEAL)).toBe(true);
    expect([...p.sync.data.keys()].some((k) => k.includes("lock:"))).toBe(false);
    const s2 = new VaultService(restartBrowser(p));
    await s2.unlock(PASSWORD);
    expect((await s2.getState()).lockPolicy).toEqual({ kind: "timeout", minutes: 15 });
  });

  describe("screen lock with a suspended service worker (mirror may only tighten)", () => {
    it("locks when the sealed policy says screen lock", async () => {
      const { p } = await setupOnly({ kind: "browser-close-or-screen-lock" });
      const fresh = new VaultService(p);
      await fresh.handleIdleState("locked");
      expect((await fresh.getState()).status).toBe("locked");
    });

    it("locks when only the plaintext mirror says screen lock", async () => {
      const { p } = await setupOnly();
      await patchSettings(p, { lockPolicy: { kind: "browser-close-or-screen-lock" } });
      const fresh = new VaultService(p);
      await fresh.handleIdleState("locked");
      expect((await fresh.getState()).status).toBe("locked");
    });

    it("does not lock when neither says screen lock", async () => {
      const { p } = await setupOnly();
      const fresh = new VaultService(p);
      await fresh.handleIdleState("locked");
      expect((await fresh.getState()).status).toBe("unlocked");
    });
  });

  describe("seal write failures never lock the user out", () => {
    it("unlock after a legacy upgrade still succeeds and persists no key", async () => {
      const p = await lockedVault();
      p.local.data.delete(SEAL);
      await patchSettings(p, { lockPolicy: { kind: "never" } });
      rejectLockPolicyWrites(p);
      const s = new VaultService(restartBrowser(p));
      await s.unlock(PASSWORD);
      expect((await s.getState()).status).toBe("unlocked");
      expect(p.local.data.has(PERSISTED)).toBe(false);
    });

    it("setup still completes", async () => {
      const p = memoryPlatform();
      rejectLockPolicyWrites(p);
      const s = new VaultService(p);
      await s.setup({
        password: PASSWORD,
        createRecoveryCode: false,
        lockPolicy: { kind: "browser-close" },
        storageArea: "local",
      });
      expect((await s.getState()).status).toBe("unlocked");
    });

    it("setLockPolicy and setRevealRequiresPassword are strict: nothing changes on failure", async () => {
      const { p, s } = await setupOnly();
      rejectLockPolicyWrites(p);
      await expect(
        s.setLockPolicy((await s.reauth(PASSWORD)).token, { kind: "never" }),
      ).rejects.toThrow();
      expect(p.local.data.has(PERSISTED)).toBe(false);
      expect((await s.getState()).lockPolicy).toEqual({ kind: "browser-close" });
      await expect(
        s.setRevealRequiresPassword((await s.reauth(PASSWORD)).token, false),
      ).rejects.toThrow();
      expect((await s.getState()).revealRequiresPassword).toBe(true);
    });
  });
});
