import { Vault } from "@otp-vault/core";
import { MemoryStorage } from "@otp-vault/core/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAILY_CHECK_MS } from "../src/background/vaultService";
import { DAY_MS, recordsStorage, SnapshotStore } from "../src/background/snapshots";
import { VaultService } from "../src/background/vaultService";
import { memoryPlatform, type TestPlatform } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

afterEach(() => vi.restoreAllMocks());

const URI = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const snapKeys = async (p: ReturnType<typeof memoryPlatform>) =>
  Object.keys(await p.local.get()).filter((k) => k.startsWith("snapshot:"));

describe("service snapshots", () => {
  it("takes a copy before deleting an account", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    p.clock.advance(1000);
    await service.deleteAccount(id);
    const list = await service.listSnapshots();
    expect(list.map((s) => s.reason)).toContain("before-delete");
    expect(list.find((s) => s.reason === "before-delete")!.accountCount).toBe(1);
    expect(list.every((s) => s.sameVault)).toBe(true);
  });

  it("takes a copy before an import commit", async () => {
    const { service } = await unlockedService();
    const preview = await service.importPreview(URI);
    if (preview.status !== "ok") throw new Error("preview");
    await service.importCommit(preview.previewId, [0]);
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-import");
  });

  it("takes a copy before a rebuild and before an area move", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.rebuildIndex();
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-rebuild");
    await service.addAccount(
      { uri: URI.replace("JBSWY3DPEHPK3PXP", "GEZDGNBVGY3TQOJQ") },
      { allowSameName: true },
    );
    const { token } = await service.reauth(PASSWORD);
    await service.setStorageArea(token, "sync");
    expect((await service.listSnapshots()).map((s) => s.reason)).toContain("before-move");
  });

  it("takes a copy before a recovery unlock", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.lock();
    await service.unlockWithRecovery(recoveryCode!, "another password 1");
    const reasons = Object.entries(await p.local.get())
      .filter(([k]) => k.startsWith("snapshot:"))
      .map(([, v]) => (v as { reason: string }).reason);
    expect(reasons).toContain("before-recovery");
  });

  it("still deletes when the snapshot cannot be stored", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    p.local.failNextSet = new Error("QUOTA_BYTES quota exceeded");
    // No previous snapshot exists, so the retry has nothing to drop and the snapshot fails.
    await p.local.remove(await snapKeys(p));
    await expect(service.deleteAccount(id)).resolves.toBeUndefined();
    expect((await service.listAccounts()).accounts).toHaveLength(0);
  });

  it("takes a daily copy from getState at most once per hour, even while locked", async () => {
    const { service, p } = await unlockedService();
    await service.lock();
    await service.getState();
    const first = (await snapKeys(p)).length;
    expect(first).toBeGreaterThanOrEqual(1);
    p.clock.advance(DAY_MS);
    await service.getState(); // a day later, but the content is unchanged
    expect((await snapKeys(p)).length).toBe(first); // same content -> deduped
  });

  it("purges old tombstones on unlock and survives a purge failure", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    await service.deleteAccount(id);
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("vault:tomb:"))).toBe(true);
    await service.lock();
    p.clock.advance(91 * DAY_MS);
    await service.unlock(PASSWORD);
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("vault:tomb:"))).toBe(false);

    await service.lock();
    vi.spyOn(Vault.prototype, "purgeTombstones").mockRejectedValueOnce(new Error("boom"));
    await expect(service.unlock(PASSWORD)).resolves.toBeUndefined();
  });

  it("deleteVault removes snapshots and quarantine", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.getState();
    await p.local.set({ "quarantine:1-x": { v: 1, createdAt: 1, records: {} } });
    const { token } = await service.reauth(PASSWORD);
    await service.deleteVault(token);
    const keys = Object.keys(await p.local.get());
    expect(keys.filter((k) => k.startsWith("snapshot:") || k.startsWith("quarantine:"))).toEqual(
      [],
    );
  });

  it("listSnapshots needs an unlocked vault", async () => {
    const { service } = await unlockedService();
    await service.lock();
    await expect(service.listSnapshots()).rejects.toMatchObject({ code: "locked" });
  });
});

const deps = (p: TestPlatform, storage: MemoryStorage | ReturnType<typeof recordsStorage>) => ({
  storage,
  random: p.random,
  clock: p.clock,
  kdf: p.kdf,
});

async function foreignSnapshot(p: TestPlatform) {
  const other = new MemoryStorage();
  await Vault.create(deps(p, other), { password: "other-vault-pw", createRecoveryCode: false });
  const snap = await new SnapshotStore(p.local, p.clock, p.random).take(other, "daily");
  return snap!;
}

describe("snapshot revocation (keyslot changes)", () => {
  it("old password no longer opens any same-vault copy after changePassword", async () => {
    const { service, p } = await unlockedService();
    await service.addAccount({ uri: URI });
    await service.getState();
    const foreign = await foreignSnapshot(p);
    const sameVault = (await service.listSnapshots()).filter((s) => s.sameVault);
    expect(sameVault.length).toBeGreaterThan(0);

    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");

    const store = new SnapshotStore(p.local, p.clock, p.random);
    for (const info of sameVault) {
      const snap = (await store.get(info.id))!;
      await expect(
        Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), PASSWORD),
      ).rejects.toMatchObject({ code: "wrong-password" });
      // The new password still opens the copy.
      await Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), "a brand new password");
    }
    expect(await store.get(foreign.id)).toEqual(foreign);
  });

  it("old recovery code no longer opens any same-vault copy after createRecoveryCode", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.getState();
    const foreign = await foreignSnapshot(p);
    const sameVault = (await service.listSnapshots()).filter((s) => s.sameVault);
    expect(sameVault.length).toBeGreaterThan(0);

    const { token } = await service.reauth(PASSWORD);
    const { recoveryCode: next } = await service.createRecoveryCode(token);

    const store = new SnapshotStore(p.local, p.clock, p.random);
    for (const info of sameVault) {
      const snap = (await store.get(info.id))!;
      expect(
        await codeOf(
          Vault.unlockWithRecovery(
            deps(p, recordsStorage(snap.records)),
            recoveryCode!,
            "x".repeat(12),
          ),
        ),
      ).toBe("invalid-recovery-code");
      expect(
        await codeOf(
          Vault.unlockWithRecovery(deps(p, recordsStorage(snap.records)), next, "x".repeat(12)),
        ),
      ).not.toBe("invalid-recovery-code");
    }
    expect(await store.get(foreign.id)).toEqual(foreign);
  });

  it("recovery unlock revokes the old password in copies", async () => {
    const { service, p, recoveryCode } = await unlockedService();
    await service.getState();
    await service.lock();
    await service.unlockWithRecovery(recoveryCode!, "another password 1");
    const store = new SnapshotStore(p.local, p.clock, p.random);
    const copies = await store.list();
    expect(copies.length).toBeGreaterThan(0);
    for (const snap of copies) {
      await expect(
        Vault.unlockWithPassword(deps(p, recordsStorage(snap.records)), PASSWORD),
      ).rejects.toMatchObject({ code: "wrong-password" });
    }
  });

  it("deletes same-vault copies when the rekey fails, leaving other vaults alone", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    const foreign = await foreignSnapshot(p);
    vi.spyOn(SnapshotStore.prototype, "rekey").mockRejectedValueOnce(new Error("boom"));
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    const left = await new SnapshotStore(p.local, p.clock, p.random).list();
    expect(left.map((s) => s.id)).toEqual([foreign.id]);
  });
});

const oldCannotOpen = async (p: TestPlatform, oldPassword: string) => {
  const store = new SnapshotStore(p.local, p.clock, p.random);
  const opened: string[] = [];
  for (const s of await store.list()) {
    try {
      await Vault.unlockWithPassword(deps(p, recordsStorage(s.records)), oldPassword);
      opened.push(s.id);
    } catch {
      // wrong-password is the expected outcome
    }
  }
  return opened;
};

describe("snapshot ordering and repair", () => {
  it("a getState copy cannot interleave with changePassword", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    await service.addAccount({ uri: URI });
    p.clock.advance(DAY_MS + 1);
    const { token } = await service.reauth(PASSWORD);
    const origGet = p.local.get.bind(p.local);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let armed = true;
    (p.local as { get: unknown }).get = async (keys?: string[]) => {
      const out = await origGet(keys);
      if (armed && !keys && /SnapshotStore\.take /.test(new Error().stack!)) {
        armed = false;
        await gate;
      }
      return out;
    };
    const gs = service.getState();
    await new Promise((r) => setTimeout(r, 10));
    const cp = service.changePassword(token, "a brand new password");
    await new Promise((r) => setTimeout(r, 50));
    release();
    await Promise.all([gs, cp]);
    (p.local as { get: unknown }).get = origGet;
    expect(await oldCannotOpen(p, PASSWORD)).toEqual([]);
  });

  it("the next unlock repairs a crash between the keyslot write and revocation", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    vi.spyOn(SnapshotStore.prototype, "rekey").mockRejectedValue(new Error("crash"));
    vi.spyOn(SnapshotStore.prototype, "removeVault").mockRejectedValue(new Error("crash"));
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    vi.restoreAllMocks();
    expect((await oldCannotOpen(p, PASSWORD)).length).toBeGreaterThan(0);
    await service.lock();
    await service.unlock("a brand new password");
    expect(await oldCannotOpen(p, PASSWORD)).toEqual([]);
  });

  it("a double failure still returns the new recovery code and unlocks", async () => {
    const { service } = await unlockedService();
    await service.getState();
    vi.spyOn(SnapshotStore.prototype, "rekey").mockRejectedValue(new Error("x"));
    vi.spyOn(SnapshotStore.prototype, "removeVault").mockRejectedValue(new Error("x"));
    const { token } = await service.reauth(PASSWORD);
    const created = await service.createRecoveryCode(token);
    expect(created.recoveryCode).toBeTruthy();
    await service.lock();
    const next = await service.unlockWithRecovery(created.recoveryCode, "another password 1");
    expect(next.recoveryCode).toBeTruthy();
    expect((await service.getState()).status).toBe("unlocked");
    vi.restoreAllMocks();
  });

  it("deleteVault forgets the key even when removing copies fails", async () => {
    const { service, p } = await unlockedService();
    vi.spyOn(SnapshotStore.prototype, "removeAll").mockRejectedValueOnce(new Error("x"));
    const { token } = await service.reauth(PASSWORD);
    await expect(service.deleteVault(token)).rejects.toThrow();
    expect(Object.keys(await p.session.get()).length).toBe(0);
    expect((await service.getState()).status).toBe("no-vault");
  });
});

describe("daily copy gating and failure isolation", () => {
  it("runs at most hourly and again when the clock moves backwards", async () => {
    const { service, p } = await unlockedService();
    const spy = vi.spyOn(SnapshotStore.prototype, "takeDaily");
    await service.getState();
    await service.getState();
    expect(spy).toHaveBeenCalledTimes(1);
    p.clock.advance(DAILY_CHECK_MS);
    await service.getState();
    expect(spy).toHaveBeenCalledTimes(2);
    p.clock.advance(-DAILY_CHECK_MS * 3);
    await service.getState();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("a throwing daily copy fails neither getState nor unlock", async () => {
    const { service } = await unlockedService();
    vi.spyOn(SnapshotStore.prototype, "takeDaily").mockRejectedValue(new Error("x"));
    expect((await service.getState()).status).toBe("unlocked");
    await service.lock();
    await expect(service.unlock(PASSWORD)).resolves.toBeUndefined();
  });

  it("takes no copy for a locked deleteAccount or an expired preview", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: URI });
    const preview = await service.importPreview(
      URI.replace("JBSWY3DPEHPK3PXP", "GEZDGNBVGY3TQOJQ"),
    );
    if (preview.status !== "ok") throw new Error("preview");
    p.clock.advance(11 * 60_000);
    await expect(service.importCommit(preview.previewId, [0])).rejects.toMatchObject({
      code: "preview-expired",
    });
    await service.lock();
    await expect(service.deleteAccount(id)).rejects.toMatchObject({ code: "locked" });
    expect(await snapKeys(p)).toEqual([]);
  });
});

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;

/** Chrome's storage returns object keys sorted; mimic it. */
function sortedLocal(p: TestPlatform) {
  const origGet = p.local.get.bind(p.local);
  (p.local as { get: unknown }).get = async (keys?: string[]) =>
    sortKeys(await origGet(keys)) as Record<string, unknown>;
}

describe("reconcile and gating (round 2)", () => {
  it("a plain unlock does not rekey when storage returns sorted keys; a password change still revokes", async () => {
    const p = memoryPlatform();
    sortedLocal(p);
    const { service } = await unlockedService(p);
    await service.getState();
    const spy = vi.spyOn(SnapshotStore.prototype, "rekey");
    await service.lock();
    await service.unlock(PASSWORD);
    expect(spy).not.toHaveBeenCalled();
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await service.lock();
    await service.unlock("a brand new password");
    expect(spy).not.toHaveBeenCalled();
    expect(await oldCannotOpen(p, PASSWORD)).toEqual([]);
  });

  it("getState does not wait on the write queue when no copy is due", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    const origSet = p.local.set.bind(p.local);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    (p.local as { set: unknown }).set = async (items: Record<string, unknown>) => {
      await gate;
      return origSet(items);
    };
    const pending = service.addAccount({ uri: URI });
    await new Promise((r) => setTimeout(r, 20));
    expect((await service.getState()).status).toBe("unlocked");
    release();
    await pending;
  });

  it("a restarted service repairs the crash window from the cached key", async () => {
    const { service, p } = await unlockedService(undefined, { kind: "never" });
    await service.getState();
    vi.spyOn(SnapshotStore.prototype, "rekey").mockRejectedValue(new Error("crash"));
    vi.spyOn(SnapshotStore.prototype, "removeVault").mockRejectedValue(new Error("crash"));
    const { token } = await service.reauth(PASSWORD);
    await service.changePassword(token, "a brand new password");
    vi.restoreAllMocks();
    expect((await oldCannotOpen(p, PASSWORD)).length).toBeGreaterThan(0);
    const restarted = new VaultService(p);
    expect((await restarted.getState()).status).toBe("unlocked");
    expect(await oldCannotOpen(p, PASSWORD)).toEqual([]);
  });

  it("setup clears leftover copies of a deleted vault", async () => {
    const { service, p } = await unlockedService();
    await service.getState();
    vi.spyOn(SnapshotStore.prototype, "removeAll").mockRejectedValueOnce(new Error("x"));
    const { token } = await service.reauth(PASSWORD);
    await expect(service.deleteVault(token)).rejects.toThrow();
    expect((await snapKeys(p)).length).toBeGreaterThan(0);
    await service.setup({
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect(await snapKeys(p)).toEqual([]);
  });

  it("a stale cache-load reconcile cannot reinstate revoked keyslots", async () => {
    const p = memoryPlatform();
    const { recoveryCode } = await unlockedService(p, { kind: "never" });
    const service = new VaultService(p);
    await service.getState();
    await service.lock();
    // Cached key was cleared by lock; log in again so a restart can load from cache.
    await service.unlock(PASSWORD);
    const restarted = new VaultService(p);
    const origSet = p.local.set.bind(p.local);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let armed = true;
    (p.local as { set: unknown }).set = async (items: Record<string, unknown>) => {
      if (armed && "vault:header" in items) {
        armed = false;
        await gate;
      }
      return origSet(items);
    };
    const recovery = restarted.unlockWithRecovery(recoveryCode!, "another password 1");
    await new Promise((r) => setTimeout(r, 20));
    await restarted.listAccounts(); // loads the old header from the cached key
    release();
    await recovery;
    await restarted.getState();
    expect(await oldCannotOpen(p, PASSWORD)).toEqual([]);
  });
});
