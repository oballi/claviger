import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { FREE_ATTEMPTS } from "../src/background/throttle";
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

/** A fresh vault on the same device that still has the old vault's copies. */
async function withForeignSnapshot() {
  const { service, p, snap } = await withSnapshot();
  const { token: del } = await service.reauth(PASSWORD);
  const keep = Object.fromEntries(
    Object.entries(await p.local.get()).filter(([k]) => k.startsWith("snapshot:")),
  );
  await service.deleteVault(del);
  const fresh = new VaultService(p);
  await fresh.setup({
    password: NEW_PASSWORD,
    createRecoveryCode: false,
    lockPolicy: { kind: "browser-close" },
    storageArea: "local",
  });
  // setup clears old copies, so put them back to simulate "kept across a quarantine".
  await p.local.set(keep);
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
    const listed = (await fresh.listSnapshots()).find((s) => s.id === snap.id)!;
    expect(listed.sameVault).toBe(false);

    const { token } = await fresh.reauth(NEW_PASSWORD);
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id))).toBe("snapshot-password-required");
    // Wrong old password keeps the token; the retry uses the SAME token.
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, "wrong password!"))).toBe(
      "wrong-password",
    );
    p.clock.advance(60_000);
    expect(await fresh.restoreSnapshot(token, snap.id, PASSWORD)).toEqual({
      added: 2,
      skipped: 0,
      unreadable: 0,
    });
    // Now spent.
    expect(await codeOf(fresh.restoreSnapshot(token, snap.id, PASSWORD))).toBe("invalid-token");
  });

  it("rejects an invalid token for another vault's copy before trying the password", async () => {
    const { fresh, snap } = await withForeignSnapshot();
    expect(await codeOf(fresh.restoreSnapshot("nope", snap.id, "wrong password!"))).toBe(
      "invalid-token",
    );
    expect((await fresh.getState()).retryAfterMs).toBe(0);
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

  it.each(["ok", "unsupported", "missing"] as const)("refuses a %s vault", async (kind) => {
    const { service, p } = await unlockedService();
    if (kind === "unsupported") await p.local.set({ "vault:header": { format: 2 } });
    if (kind === "missing") await p.local.remove(["vault:header"]);
    const before = await p.local.get();
    expect(await codeOf(service.quarantineVault())).toBe("invalid-request");
    expect(await p.local.get()).toEqual(before);
  });
});
