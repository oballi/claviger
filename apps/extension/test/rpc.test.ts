import { CoreError } from "@otp-vault/core";
import { describe, expect, it } from "vitest";
import { VaultService } from "../src/background/vaultService";
import { createRpcClient, RpcError } from "@otp-vault/ui/rpc-client";
import { RPC_CHANNEL } from "@otp-vault/ui/protocol";
import { handleRpcMessage, isRpcEnvelope, isTrustedSender } from "../src/rpc/server";
import { memoryPlatform } from "./helpers/platform";
import { PASSWORD } from "./helpers/service";

const ctx = { extensionId: "ext-id", extensionOrigin: "chrome-extension://ext-id/" };
const trusted = { id: "ext-id", url: "chrome-extension://ext-id/popup.html" };
const SECRET = "JBSWY3DPEHPK3PXP";

function clientFor(service: VaultService) {
  return createRpcClient((message) => handleRpcMessage(service, message, trusted, ctx));
}

function failing(method: string, error: Error): VaultService {
  return {
    [method]: async () => {
      throw error;
    },
  } as unknown as VaultService;
}

describe("envelope and sender checks", () => {
  it("recognises only RPC envelopes", () => {
    expect(isRpcEnvelope({ channel: RPC_CHANNEL, request: {} })).toBe(true);
    expect(isRpcEnvelope({ channel: "other" })).toBe(false);
    expect(isRpcEnvelope(null)).toBe(false);
    expect(isRpcEnvelope("x")).toBe(false);
  });

  it("ignores messages for other channels", async () => {
    expect(
      await handleRpcMessage(new VaultService(memoryPlatform()), { hello: 1 }, trusted, ctx),
    ).toBeUndefined();
  });

  it.each([
    { id: "ext-id", url: "https://evil.example/login" },
    { id: "other-ext", url: "chrome-extension://other-ext/popup.html" },
    { id: "other-ext", url: "chrome-extension://ext-id/popup.html" },
    { url: "chrome-extension://ext-id/popup.html" },
    { id: "ext-id" },
    {},
  ])("rejects an untrusted sender %j", async (sender) => {
    expect(isTrustedSender(sender, ctx)).toBe(false);
    const response = await handleRpcMessage(
      new VaultService(memoryPlatform()),
      { channel: RPC_CHANNEL, request: { type: "getState" } },
      sender,
      ctx,
    );
    expect(response).toEqual({
      ok: false,
      error: { code: "forbidden", message: "Untrusted sender" },
    });
  });

  it("handles Firefox origins and lookalikes", () => {
    const moz = { extensionId: "ext@id", extensionOrigin: "moz-extension://1234-uuid/" };
    expect(
      isTrustedSender({ id: "ext@id", url: "moz-extension://1234-uuid/manage.html" }, moz),
    ).toBe(true);
    expect(
      isTrustedSender({ id: "ext@id", url: "moz-extension://1234-uuid-evil/x.html" }, moz),
    ).toBe(false);
  });

  it("normalizes an origin without a trailing slash", () => {
    const bare = { extensionId: "ext", extensionOrigin: "chrome-extension://ext" };
    expect(isTrustedSender({ id: "ext", url: "chrome-extension://ext/popup.html" }, bare)).toBe(
      true,
    );
    expect(
      isTrustedSender({ id: "ext", url: "chrome-extension://extother/popup.html" }, bare),
    ).toBe(false);
  });

  it("rejects over-long input before it reaches the service", async () => {
    let calls = 0;
    const spy = {
      unlock: async () => {
        calls++;
      },
    } as unknown as VaultService;
    const response = await handleRpcMessage(
      spy,
      { channel: RPC_CHANNEL, request: { type: "unlock", password: "x".repeat(1025) } },
      trusted,
      ctx,
    );
    expect(response).toEqual({
      ok: false,
      error: { code: "invalid-request", message: "Malformed request" },
    });
    expect(calls).toBe(0);
  });

  it.each([
    { type: "listAccounts", pageUrl: "h".repeat(8193) },
    { type: "addAccountUri", uri: "u".repeat(8193) },
    { type: "addAccountManual", draft: { secret: "s".repeat(1025) } },
    { type: "addAccountManual", draft: { secret: "A", issuer: "i".repeat(513) } },
    { type: "addAccountManual", draft: { secret: "A", domains: Array(101).fill("a.com") } },
    { type: "addAccountManual", draft: { secret: "A", domains: ["d".repeat(254)] } },
    { type: "reorder", order: Array(10001).fill("a") },
    { type: "reorder", order: ["a".repeat(65)] },
    { type: "createGroup", name: "x".repeat(201) },
    { type: "renameGroup", id: "a".repeat(65), name: "B" },
    { type: "deleteGroup", id: "a".repeat(65) },
    { type: "setAccountGroup", id: "a".repeat(65), groupId: null },
    { type: "renameGroup", id: "a", name: "x".repeat(201) },
    { type: "reorderGroups", ids: Array(31).fill("a") },
    { type: "reorderGroups", ids: ["a".repeat(65)] },
    { type: "setAccountGroup", id: "a", groupId: "" },
    { type: "updateAccount", id: "a", patch: { groupId: "g".repeat(65) } },
    { type: "importCommit", previewId: "p".repeat(65), indexes: [0] },
    { type: "applyClockSample", serverDate: "d".repeat(65), startMs: 0, endMs: 1 },
    { type: "importCommit", previewId: "p", indexes: Array(10001).fill(0) },
    { type: "unlockWithRecovery", code: "c".repeat(129), newPassword: "long enough password" },
    { type: "setClipboardClear", seconds: 45 },
    { type: "setViewMode", mode: "x" },
    { type: "setTheme", theme: "x" },
    { type: "fillCode", id: "a", tabId: -1 },
    { type: "fillCode", id: "a", tabId: 1.5 },
    { type: "fillCode", id: "", tabId: 1 },
    { type: "setFillOnlyLinked", value: "yes" },
    { type: "setSiteMemory" },
  ])("caps input sizes %#", async (request) => {
    const response = await handleRpcMessage(
      new VaultService(memoryPlatform()),
      { channel: RPC_CHANNEL, request },
      trusted,
      ctx,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "invalid-request" } });
  });

  it.each([
    { type: "nope" },
    { type: "unlock" },
    { type: "reorder", order: "x" },
    { type: "setRevealRequiresPassword", token: "t" },
    { type: "deleteVault" },
    "string",
    null,
  ])("rejects a malformed request %j", async (request) => {
    const response = await handleRpcMessage(
      new VaultService(memoryPlatform()),
      { channel: RPC_CHANNEL, request },
      trusted,
      ctx,
    );
    expect(response).toEqual({
      ok: false,
      error: { code: "invalid-request", message: "Malformed request" },
    });
  });

  it("reports browser quota errors clearly", async () => {
    const response = await handleRpcMessage(
      failing("getState", new Error("QUOTA_BYTES quota exceeded")),
      { channel: RPC_CHANNEL, request: { type: "getState" } },
      trusted,
      ctx,
    );
    expect(response).toEqual({
      ok: false,
      error: { code: "quota-exceeded", message: "Browser storage is full" },
    });
  });

  it("does not call write rate limits quota errors", async () => {
    const response = await handleRpcMessage(
      failing("getState", new Error("MAX_WRITE_OPERATIONS_PER_MINUTE quota exceeded")),
      { channel: RPC_CHANNEL, request: { type: "getState" } },
      trusted,
      ctx,
    );
    expect(response).toEqual({
      ok: false,
      error: { code: "internal", message: "Unexpected error" },
    });
  });

  it("does not treat any message containing quota as a quota error", async () => {
    const response = await handleRpcMessage(
      failing("getState", new Error("quota is fine")),
      { channel: RPC_CHANNEL, request: { type: "getState" } },
      trusted,
      ctx,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "internal" } });
  });

  it("hides unexpected errors", async () => {
    for (const error of [new TypeError(`leaked ${SECRET}`), new Error("secret-ish detail")]) {
      const response = await handleRpcMessage(
        failing("getState", error),
        { channel: RPC_CHANNEL, request: { type: "getState" } },
        trusted,
        ctx,
      );
      expect(response).toEqual({
        ok: false,
        error: { code: "internal", message: "Unexpected error" },
      });
    }
  });

  it("maps core errors to their code without the cause", async () => {
    const call = createRpcClient((m) =>
      handleRpcMessage(
        failing("getState", new CoreError("invalid-hex", "bad input", { cause: SECRET })),
        m,
        trusted,
        ctx,
      ),
    );
    const error = await call("getState", {}).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: "invalid-hex", message: "invalid-hex" });
    expect(JSON.stringify(error)).not.toContain("bad input");
    expect(JSON.stringify(error)).not.toContain(SECRET);
  });

  it("maps applyClockSample ServiceErrors to invalid-request", async () => {
    const call = clientFor(new VaultService(memoryPlatform()));
    // Check disabled by default.
    await expect(
      call("applyClockSample", { serverDate: "x", startMs: 0, endMs: 0 }),
    ).rejects.toMatchObject({
      code: "invalid-request",
    });
    await call("setClockCheckEnabled", { enabled: true });
    await expect(
      call("applyClockSample", { serverDate: "not a date", startMs: 0, endMs: 0 }),
    ).rejects.toMatchObject({ code: "invalid-request" });
    await expect(
      call("applyClockSample", {
        serverDate: new Date(13 * 3600_000).toUTCString(),
        startMs: 0,
        endMs: 0,
      }),
    ).rejects.toMatchObject({ code: "invalid-request" });
  });
});

describe("fill rpc", () => {
  it("fills through the service and ignores a UI-supplied tab url", async () => {
    const p = memoryPlatform();
    const service = new VaultService(p);
    const call = clientFor(service);
    await call("setup", {
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    const { id } = await call("addAccountUri", {
      uri: `otpauth://totp/Bank:me?secret=${SECRET}&issuer=Bank`,
      sourceUrl: "https://bank.com/",
    });
    p.tabs.activeTab = { id: 4, url: "https://evil.io/" };
    // Extra fields are stripped: the service only trusts the URL it reads itself.
    const forged = { id, tabId: 4, tabUrl: "https://bank.com/" };
    await expect(call("fillCode", forged as never)).rejects.toMatchObject({ code: "not-linked" });
    p.tabs.activeTab = { id: 4, url: "https://bank.com/" };
    expect(await call("fillCode", { id, tabId: 4 })).toEqual({ result: "filled", code: null });
    await call("setFillOnlyLinked", { value: false });
    await call("setSiteMemory", { value: false });
    const state = await call("getState", {});
    expect([state.fillOnlyLinked, state.siteMemory]).toEqual([false, false]);
  });

  it("rejects fillCode from an untrusted sender", async () => {
    const response = await handleRpcMessage(
      new VaultService(memoryPlatform()),
      { channel: RPC_CHANNEL, request: { type: "fillCode", id: "a", tabId: 1 } },
      { id: "ext-id", url: "https://evil.example/" },
      ctx,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});

describe("client", () => {
  it("throws RpcError with the code and retry delay", async () => {
    const call = clientFor(new VaultService(memoryPlatform()));
    await call("setup", {
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    await call("lock", {});
    const error = await call("unlock", { password: "wrong password" }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: "wrong-password", retryAfterMs: 0 });
    await expect(call("listAccounts", {})).rejects.toMatchObject({ code: "locked" });
  });

  it("reports a missing response", async () => {
    const call = createRpcClient(async () => undefined);
    await expect(call("getState", {})).rejects.toMatchObject({ code: "no-response" });
  });

  it("drives every request type end to end", async () => {
    const p = memoryPlatform();
    const call = clientFor(new VaultService(p));

    expect((await call("getState", {})).status).toBe("no-vault");
    const { recoveryCode } = await call("setup", {
      password: PASSWORD,
      createRecoveryCode: true,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect(recoveryCode).toBeTruthy();

    const { id } = await call("addAccountUri", {
      uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
      sourceUrl: "https://github.com/settings",
    });
    const manual = await call("addAccountManual", {
      draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "Bank", type: "hotp" },
    });
    await call("updateAccount", { id, patch: { label: "work" } });
    const grp = await call("createGroup", { name: "Work" });
    await call("setAccountGroup", { id, groupId: grp.id });
    await call("renameGroup", { id: grp.id, name: "Office" });
    await call("reorderGroups", { ids: [grp.id] });
    expect((await call("listAccounts", {})).groups).toEqual([{ id: grp.id, name: "Office" }]);
    await call("updateAccount", { id, patch: { groupId: null } });
    await call("setAccountGroup", { id, groupId: grp.id });
    await call("deleteGroup", { id: grp.id });
    await call("setPinned", { id: manual.id, pinned: true });
    await call("reorder", { order: [manual.id, id] });
    expect((await call("nextHotp", { id: manual.id })).code).toMatch(/^\d{6}$/);
    const list = await call("listAccounts", { pageUrl: "https://github.com/login" });
    expect(list.accounts.map((a) => a.id)).toEqual([manual.id, id]);
    expect(list.matches.exact).toEqual([id]);
    await call("rebuildIndex", {});

    const token = async (password = PASSWORD) => (await call("reauth", { password })).token;
    expect((await call("revealSecret", { token: await token(), id })).uri).toContain(SECRET);

    // Tokenless reveal: refused by default, allowed once the setting is turned off.
    await expect(call("revealSecret", { id })).rejects.toMatchObject({ code: "invalid-token" });
    const state = await call("getState", {});
    expect(state).toMatchObject({
      accountCount: 2,
      revealRequiresPassword: true,
      lastBackupAt: null,
    });
    await call("setRevealRequiresPassword", { token: await token(), value: false });
    expect((await call("revealSecret", { id })).uri).toContain(SECRET);
    expect((await call("getState", {})).revealRequiresPassword).toBe(false);

    const exported = await call("exportVault", {
      token: await token(),
      format: "otpvault",
      exportPassword: "export password",
    });
    expect(exported).toMatchObject({ count: 2, skipped: 0 });
    expect((await call("getState", {})).lastBackupAt).not.toBeNull();
    const preview = await call("importPreview", {
      text: exported.content,
      password: "export password",
    });
    expect(preview.status).toBe("ok");
    if (preview.status === "ok") {
      expect(await call("importCommit", { previewId: preview.previewId, indexes: [0, 1] })).toEqual(
        {
          added: 0,
          duplicates: 2,
          ungrouped: 0,
        },
      );
    }
    expect((await call("createRecoveryCode", { token: await token() })).recoveryCode).not.toBe(
      recoveryCode,
    );
    await call("setLockPolicy", { token: await token(), policy: { kind: "timeout", minutes: 15 } });
    await call("setStorageArea", { token: await token(), area: "sync" });
    expect((await call("storageUsage", {})).area).toBe("sync");
    await call("setClockCheckEnabled", { enabled: true });
    expect(
      await call("applyClockSample", {
        serverDate: new Date(60_000).toUTCString(),
        startMs: 0,
        endMs: 0,
      }),
    ).toEqual({ offsetSec: 60, applied: 60 });
    await call("changePassword", { token: await token(), newPassword: "another long password" });
    await call("deleteAccount", { id });

    await call("lock", {});
    await call("unlock", { password: "another long password" });
    const recovered = await call("unlockWithRecovery", {
      code: (await call("createRecoveryCode", { token: await token("another long password") }))
        .recoveryCode,
      newPassword: "final long password",
    });
    expect(recovered.recoveryCode).toBeTruthy();
    expect((await call("getState", {})).status).toBe("unlocked");

    await call("deleteVault", { token: await token("final long password") });
    expect((await call("getState", {})).status).toBe("no-vault");
  });
});

describe("group rpcs", () => {
  it.each([
    { type: "createGroup", name: "A" },
    { type: "renameGroup", id: "a", name: "B" },
    { type: "deleteGroup", id: "a" },
    { type: "reorderGroups", ids: ["a"] },
    { type: "setAccountGroup", id: "a", groupId: null },
  ])("forbids $type from an untrusted sender", async (request) => {
    const response = await handleRpcMessage(
      new VaultService(memoryPlatform()),
      { channel: RPC_CHANNEL, request },
      { id: "ext-id", url: "https://evil.example/" },
      ctx,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});

describe("listSnapshots rpc", () => {
  it("returns a list for a trusted sender and forbids an untrusted one", async () => {
    const service = new VaultService(memoryPlatform());
    const call = clientFor(service);
    await call("setup", {
      password: PASSWORD,
      createRecoveryCode: false,
      lockPolicy: { kind: "browser-close" },
      storageArea: "local",
    });
    expect(Array.isArray(await call("listSnapshots", {}))).toBe(true);
    const response = await handleRpcMessage(
      service,
      { channel: RPC_CHANNEL, request: { type: "listSnapshots" } },
      { id: "ext-id", url: "https://evil.example/" },
      ctx,
    );
    expect(response).toMatchObject({ ok: false, error: { code: "forbidden" } });
    const theme = await handleRpcMessage(
      service,
      { channel: RPC_CHANNEL, request: { type: "setTheme", theme: "dark" } },
      { id: "ext-id", url: "https://evil.example/" },
      ctx,
    );
    expect(theme).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});
