import { Vault } from "@otp-vault/core";
import { describe, expect, it, vi } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { ATTEMPTS_KEY, FREE_ATTEMPTS, SNAPSHOT_ATTEMPTS_KEY } from "../src/background/throttle";
import type { TestPlatform } from "./helpers/platform";
import { codeOf, PASSWORD, unlockedService } from "./helpers/service";

const A = "otpauth://totp/Acme:a@x?secret=JBSWY3DPEHPK3PXP&issuer=Acme";
const B = "otpauth://totp/Beta:b@x?secret=JBSWY3DPEHPK3PXQ&issuer=Beta";
const NEW_PASSWORD = "new password 123";

async function withSnapshot() {
  const h = await unlockedService();
  const { id: a } = await h.service.addAccount({ uri: A });
  await h.service.addAccount({ uri: B });
  h.p.clock.advance(1000);
  await h.service.deleteAccount(a); // before-delete copy holds A and B
  const snap = (await h.service.listSnapshots()).find((s) => s.reason === "before-delete")!;
  return { ...h, snap };
}

/** Real flow: the vault turns corrupt, is moved aside, and a new vault is set up. */
async function withForeignSnapshot() {
  const { service, p, snap } = await withSnapshot();
  await p.local.set({ "vault:header": { format: 1, nope: true } });
  await service.quarantineVault();
  const fresh = new VaultService(p);
  await fresh.setup({
    password: NEW_PASSWORD,
    createRecoveryCode: false,
    lockPolicy: { kind: "browser-close" },
    storageArea: "local",
  });
  return { fresh, p, snap };
}

describe("restoreSnapshot", () => {
  it("adds only the missing accounts and reports counts", async () => {
    const { service, snap } = await withSnapshot();
    const { token } = await service.reauth(PASSWORD);
    expect(await service.restoreSnapshot(token, snap.id)).toEqual({
      added: 1,
      skipped: 1,
      unreadable: 0,
      ungrouped: 0,
    });
    const names = (await service.listAccounts()).accounts.map((a) => a.issuer).sort();
    expect(names).toEqual(["Acme", "Beta"]);
  });

  it("needs a fresh token", async () => {
    const { service, snap } = await withSnapshot();
    expect(await codeOf(service.restoreSnapshot("nope", snap.id))).toBe("invalid-token");
  });

  it("reports an unknown snapshot without spending the token", async () => {
    const { service, snap } = await withSnapshot();
    const { token } = await service.reauth(PASSWORD);
    expect(await codeOf(service.restoreSnapshot(token, "missing"))).toBe("not-found");
    await expect(service.restoreSnapshot(token, snap.id)).resolves.toMatchObject({ added: 1 });
  });

  it("restores another vault's copy only with that vault's password", async () => {
    const { fresh, p, snap } = await withForeignSnapshot();
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("quarantine:"))).toBe(true);
    const listed = (await fresh.listSnapshots()).find((s) => s.id === snap.id)!;
    expect(listed.sameVault).toBe(false);

    const { token } = await fresh.reauth(NEW_PASSWORD);
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id))).toBe("snapshot-password-required");
    // Wrong old password keeps the token; the retry uses the SAME token.
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, "wrong password!"))).toBe(
      "wrong-password",
    );
    expect(await fresh.restoreSnapshot(token, snap.id, PASSWORD)).toEqual({
      added: 2,
      skipped: 0,
      unreadable: 0,
      ungrouped: 0,
    });
    // Now spent.
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, PASSWORD))).toBe("invalid-token");
  });

  it("rejects an invalid token for another vault's copy before trying the password", async () => {
    const { fresh, p, snap } = await withForeignSnapshot();
    expect(await codeOf(fresh.restoreSnapshot("nope", snap.id, "wrong password!"))).toBe(
      "invalid-token",
    );
    expect((await p.local.get([ATTEMPTS_KEY]))[ATTEMPTS_KEY]).toBeUndefined();
  });

  it("throttles repeated wrong old passwords", async () => {
    const { fresh, snap } = await withForeignSnapshot();
    const { token } = await fresh.reauth(NEW_PASSWORD);
    for (let i = 0; i < FREE_ATTEMPTS; i++) {
      expect(await codeOf(fresh.restoreSnapshot(token, snap.id, "wrong password!"))).toBe(
        "wrong-password",
      );
    }
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, PASSWORD))).toBe("throttled");
  });

  it("keeps throttling old-password guesses across fresh reauths", async () => {
    const { fresh, p, snap } = await withForeignSnapshot();
    for (let i = 0; i < FREE_ATTEMPTS; i++) {
      const { token } = await fresh.reauth(NEW_PASSWORD);
      expect(await codeOf(fresh.restoreSnapshot(token, snap.id, "wrong password!"))).toBe(
        "wrong-password",
      );
    }
    const { token } = await fresh.reauth(NEW_PASSWORD);
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, PASSWORD))).toBe("throttled");
    const keys = Object.keys(await p.local.get());
    expect(keys).toContain(SNAPSHOT_ATTEMPTS_KEY);
    expect(SNAPSHOT_ATTEMPTS_KEY).not.toBe(ATTEMPTS_KEY);
    p.clock.advance(60_000);
    expect((await fresh.restoreSnapshot(token, snap.id, PASSWORD)).added).toBe(2);
    expect((await p.local.get([SNAPSHOT_ATTEMPTS_KEY]))[SNAPSHOT_ATTEMPTS_KEY]).toBeUndefined();
  });

  it("deleteVault also clears the old-password throttle", async () => {
    const { fresh, p } = await withForeignSnapshot();
    await p.local.set({ [SNAPSHOT_ATTEMPTS_KEY]: { failures: 9, lastFailureAt: p.clock.now() } });
    const { token } = await fresh.reauth(NEW_PASSWORD);
    await fresh.deleteVault(token);
    expect((await p.local.get([SNAPSHOT_ATTEMPTS_KEY]))[SNAPSHOT_ATTEMPTS_KEY]).toBeUndefined();
  });

  it("refuses a damaged copy without spending the token", async () => {
    const { service, p, snap } = await withSnapshot();
    const key = `snapshot:${snap.id}`;
    const raw = (await p.local.get([key]))[key] as { records: Record<string, unknown> };
    delete raw.records["vault:header"];
    await p.local.set({ [key]: raw });
    const { token } = await service.reauth(PASSWORD);
    expect(await codeOf(service.restoreSnapshot(token, snap.id))).toBe("invalid-request");
    raw.records["vault:header"] = (await p.local.get(["vault:header"]))["vault:header"];
    await p.local.set({ [key]: raw });
    await expect(service.restoreSnapshot(token, snap.id)).resolves.toMatchObject({ added: 1 });
  });

  it("refuses to restore while the index is damaged, keeping the token", async () => {
    const { service, p, snap } = await withSnapshot();
    const { token } = await service.reauth(PASSWORD);
    const good = (await p.local.get(["vault:index"]))["vault:index"];
    await p.local.set({ "vault:index": { garbage: true } });
    expect(await codeOf(service.restoreSnapshot(token, snap.id))).toBe("invalid-request");
    await p.local.set({ "vault:index": good });
    await expect(service.restoreSnapshot(token, snap.id)).resolves.toMatchObject({ added: 1 });
  });

  it("does not bring back an account deleted before the copy was taken", async () => {
    const { service, p } = await unlockedService();
    const { id } = await service.addAccount({ uri: A });
    await service.deleteAccount(id);
    p.clock.advance(1000);
    await service.addAccount({ uri: B });
    p.clock.advance(1000);
    const { id: b } = (await service.listAccounts()).accounts[0]!;
    await service.deleteAccount(b);
    const snap = (await service.listSnapshots())[0]!;
    const { token } = await service.reauth(PASSWORD);
    await service.restoreSnapshot(token, snap.id);
    expect((await service.listAccounts()).accounts.map((a) => a.issuer)).toEqual(["Beta"]);
  });
});

describe("snapshotOffer", () => {
  it("offers the newest non-empty copy when the vault is empty", async () => {
    const { service } = await withSnapshot();
    const { accounts } = await service.listAccounts();
    for (const a of accounts) await service.deleteAccount(a.id);
    const state = await service.getState();
    expect(state.snapshotOffer!.accountCount).toBeGreaterThan(0);
  });

  it("is null while there are accounts or while locked", async () => {
    const { service } = await withSnapshot();
    expect((await service.getState()).snapshotOffer).toBeNull();
    await service.lock();
    expect((await service.getState()).snapshotOffer).toBeNull();
  });
});

describe("quarantineVault", () => {
  it("moves a corrupt vault aside so setup can start", async () => {
    const { service, p } = await unlockedService();
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    expect((await service.getState()).status).toBe("corrupt");
    const { moved } = await service.quarantineVault();
    expect(moved).toBeGreaterThan(0);
    expect((await service.getState()).status).toBe("no-vault");
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("quarantine:"))).toBe(true);
  });

  it("does not copy the missing vault into a daily snapshot afterwards", async () => {
    const { service, p } = await unlockedService();
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    await service.quarantineVault();
    const before = Object.keys(await p.local.get()).filter((k) => k.startsWith("snapshot:"));
    p.clock.advance(2 * 24 * 3600 * 1000);
    expect((await service.getState()).status).toBe("no-vault");
    const after = Object.keys(await p.local.get()).filter((k) => k.startsWith("snapshot:"));
    expect(after).toEqual(before);
  });

  it("aborts without writing when the vault is no longer corrupt at move time", async () => {
    const { service, p } = await unlockedService();
    const good = (await p.local.get(["vault:header"]))["vault:header"];
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    const real = Vault.inspect.bind(Vault);
    const spy = vi.spyOn(Vault, "inspect").mockImplementationOnce(async (st) => {
      const r = await real(st);
      // Simulates a sync repair landing right after the service inspected the vault.
      await p.local.set({ "vault:header": good });
      return r;
    });
    expect(await codeOf(service.quarantineVault())).toBe("invalid-request");
    spy.mockRestore();
    expect((await p.local.get(["vault:header"]))["vault:header"]).toEqual(good);
    expect(Object.keys(await p.local.get()).some((k) => k.startsWith("quarantine:"))).toBe(false);
  });

  it.each(["ok", "unsupported", "missing"] as const)("refuses a %s vault", async (kind) => {
    const { service, p } = await unlockedService();
    if (kind === "unsupported") await p.local.set({ "vault:header": { format: 2 } });
    if (kind === "missing") await p.local.remove(["vault:header"]);
    const before = await p.local.get();
    expect(await codeOf(service.quarantineVault())).toBe("invalid-request");
    expect(await p.local.get()).toEqual(before);
  });
});

describe("purge marker", () => {
  const corruptAndQuarantine = async (service: VaultService, p: TestPlatform) => {
    await p.local.set({ "vault:header": { format: 1, nope: true } });
    await service.quarantineVault();
  };
  const setupFresh = (p: TestPlatform) =>
    new VaultService(p).setup({
      password: NEW_PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
  const keysOf = async (p: TestPlatform, prefix: string) =>
    Object.keys(await p.local.get()).filter((k) => k.startsWith(prefix));

  it("setup keeps copies and quarantine when no purge is pending", async () => {
    const { p } = await withForeignSnapshot();
    expect((await keysOf(p, "snapshot:")).length).toBeGreaterThan(0);
    expect((await keysOf(p, "quarantine:")).length).toBeGreaterThan(0);
    expect((await p.local.get(["snapshotPurgePending"])).snapshotPurgePending).toBeUndefined();
  });

  it("setup purges copies and quarantine and clears the marker when a purge is pending", async () => {
    const { service, p } = await withSnapshot();
    await corruptAndQuarantine(service, p);
    await p.local.set({ snapshotPurgePending: true });
    await setupFresh(p);
    expect(await keysOf(p, "snapshot:")).toEqual([]);
    expect(await keysOf(p, "quarantine:")).toEqual([]);
    expect((await p.local.get(["snapshotPurgePending"])).snapshotPurgePending).toBeUndefined();
  });

  it("a deleteVault that fails midway leaves no marker that could wipe a later quarantine", async () => {
    const { service, p } = await withSnapshot();
    const { token } = await service.reauth(PASSWORD);
    vi.spyOn(p.local, "remove").mockRejectedValueOnce(new Error("x"));
    await expect(service.deleteVault(token)).rejects.toThrow();
    expect((await p.local.get(["snapshotPurgePending"])).snapshotPurgePending).toBeUndefined();
    await corruptAndQuarantine(new VaultService(p), p);
    await setupFresh(p);
    expect((await keysOf(p, "quarantine:")).length).toBeGreaterThan(0);
    expect((await keysOf(p, "snapshot:")).length).toBeGreaterThan(0);
  });

  it("a stale marker is cleared once a vault is live, so a later quarantine and setup keep data", async () => {
    const { service, p } = await withSnapshot();
    await p.local.set({ snapshotPurgePending: true });
    await service.lock();
    await service.unlock(PASSWORD);
    expect((await p.local.get(["snapshotPurgePending"])).snapshotPurgePending).toBeUndefined();
    await corruptAndQuarantine(service, p);
    await setupFresh(p);
    expect((await keysOf(p, "quarantine:")).length).toBeGreaterThan(0);
    expect((await keysOf(p, "snapshot:")).length).toBeGreaterThan(0);
  });
});

describe("restoreSnapshot groups", () => {
  it("keeps groups when restoring into another vault", async () => {
    const h = await unlockedService();
    const { id: a } = await h.service.addAccount({ uri: A });
    const g = await h.service.createGroup("Work");
    await h.service.setAccountGroup(a, g.id);
    h.p.clock.advance(1000);
    await h.service.deleteAccount(a);
    const snap = (await h.service.listSnapshots()).find((s) => s.reason === "before-delete")!;
    await h.p.local.set({ "vault:header": { format: 1, nope: true } });
    await h.service.quarantineVault();
    const fresh = new VaultService(h.p);
    await fresh.setup({
      password: NEW_PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    const { token } = await fresh.reauth(NEW_PASSWORD);
    expect(await fresh.restoreSnapshot(token, snap.id, PASSWORD)).toMatchObject({
      added: 1,
      ungrouped: 0,
    });
    const listing = await fresh.listAccounts();
    expect(listing.groups.map((x) => x.name)).toEqual(["Work"]);
    expect(listing.accounts[0]!.groupId).toBe(listing.groups[0]!.id);
  });

  async function groupedSnapshot() {
    const h = await unlockedService();
    const { id: a } = await h.service.addAccount({ uri: A });
    const g = await h.service.createGroup("Work");
    await h.service.setAccountGroup(a, g.id);
    h.p.clock.advance(1000);
    await h.service.deleteAccount(a);
    const snap = (await h.service.listSnapshots()).find((s) => s.reason === "before-delete")!;
    return { ...h, snap, g };
  }

  it("keeps the group of a restored account in the same vault", async () => {
    const { service, snap, g } = await groupedSnapshot();
    const { token } = await service.reauth(PASSWORD);
    expect(await service.restoreSnapshot(token, snap.id)).toMatchObject({
      added: 1,
      ungrouped: 0,
    });
    const listing = await service.listAccounts();
    expect(listing.groups.map((x) => x.id)).toEqual([g.id]);
    expect(listing.accounts[0]!.groupId).toBe(g.id);
  });

  it("restores ungrouped, without recreating the group, when it was deleted meanwhile", async () => {
    const { service, snap, g } = await groupedSnapshot();
    await service.deleteGroup(g.id);
    const { token } = await service.reauth(PASSWORD);
    expect(await service.restoreSnapshot(token, snap.id)).toMatchObject({
      added: 1,
      ungrouped: 1,
    });
    const listing = await service.listAccounts();
    expect(listing.groups).toEqual([]);
    expect(listing.accounts[0]!.groupId ?? null).toBeNull();
  });
});
