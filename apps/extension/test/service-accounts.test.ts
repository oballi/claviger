import { generateCode } from "@claviger/core";
import { describe, expect, it } from "vitest";
import { saveSettings } from "../src/background/settings";
import { AUTOLOCK_ALARM } from "../src/background/vaultService";
import { memoryPlatform } from "./helpers/platform";
import { codeOf, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const totp = (offsetSec = 0, now = 0) =>
  generateCode(
    { type: "totp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
    now,
    offsetSec,
  );

describe("listing", () => {
  it("returns live codes and never the secret", async () => {
    const { p, service } = await unlockedService();
    const { id } = await service.addAccount({
      uri: `otpauth://totp/GitHub:me?secret=${SECRET}&issuer=GitHub`,
    });
    const view = await service.listAccounts();
    const expected = await totp(0, p.clock.now());
    expect(view).toEqual({
      accounts: [
        {
          id,
          type: "totp",
          issuer: "GitHub",
          label: "me",
          algorithm: "SHA1",
          digits: 6,
          period: 30,
          domains: [],
          pinned: false,
          groupId: null,
          code: expected.code,
          remaining: expected.remaining,
          nextCode: null,
        },
      ],
      groups: [],
      unreadable: [],
      indexDamaged: false,
      matches: { exact: [] },
      pageDomain: null,
    });
    expect(JSON.stringify(view)).not.toContain(SECRET);
  });

  it("applies the saved clock offset", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/x?secret=${SECRET}` });
    await saveSettings(p.local, { clockOffsetSec: 120 });
    expect((await service.listAccounts()).accounts[0]!.code).toBe(
      (await totp(120, p.clock.now())).code,
    );
  });

  it("binds the source tab's domain; an unlinked account named after the site stays out of exact", async () => {
    const { service } = await unlockedService();
    const bound = await service.addAccount(
      { uri: `otpauth://totp/GitHub:me?secret=${SECRET}` },
      { sourceUrl: "https://login.github.com/session" },
    );
    const unlinked = await service.addAccount({
      draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "GitHub", label: "work" },
    });
    const view = await service.listAccounts({ pageUrl: "https://github.com/login" });
    expect(view.accounts.find((a) => a.id === bound.id)!.domains).toEqual(["github.com"]);
    expect(view.matches).toEqual({ exact: [bound.id] });
    expect(view.matches.exact).not.toContain(unlinked.id);
  });

  it("ignores non-web source pages when binding domains", async () => {
    const { service } = await unlockedService();
    const { id } = await service.addAccount(
      { uri: `otpauth://totp/x?secret=${SECRET}` },
      { sourceUrl: "chrome://extensions" },
    );
    expect((await service.listAccounts()).accounts.find((a) => a.id === id)!.domains).toEqual([]);
  });

  it("warns about a different secret under the same name unless allowed", async () => {
    const { service } = await unlockedService();
    await service.addAccount({
      draft: { secret: "JBSWY3DPEHPK3PXP", issuer: "Bank", label: "me" },
    });
    expect(
      await codeOf(
        service.addAccount({
          draft: { secret: "JBSWY3DPEHPK3PXQ", issuer: " bank ", label: "ME" },
        }),
      ),
    ).toBe("same-name");
    await expect(
      service.addAccount(
        { draft: { secret: "JBSWY3DPEHPK3PXQ", issuer: "Bank", label: "me" } },
        { allowSameName: true },
      ),
    ).resolves.toMatchObject({ name: "Bank" });
  });

  it("still reports a true duplicate as duplicate-account", async () => {
    const { service } = await unlockedService();
    const draft = { secret: "JBSWY3DPEHPK3PXP", issuer: "Bank", label: "me" };
    await service.addAccount({ draft });
    expect(await codeOf(service.addAccount({ draft }, { allowSameName: true }))).toBe(
      "duplicate-account",
    );
  });

  it("reports a true duplicate even when another account shares the name", async () => {
    const { service } = await unlockedService();
    await service.addAccount({
      draft: { secret: "JBSWY3DPEHPK3PXP", issuer: "Bank", label: "me" },
    });
    await service.addAccount(
      { draft: { secret: "JBSWY3DPEHPK3PXQ", issuer: "Bank", label: "me" } },
      { allowSameName: true },
    );
    expect(
      await codeOf(
        service.addAccount({ draft: { secret: "JBSWY3DPEHPK3PXP", issuer: "Bank", label: "me" } }),
      ),
    ).toBe("duplicate-account");
  });

  it("returns the registrable domain of the page", async () => {
    const { service } = await unlockedService();
    expect(
      (await service.listAccounts({ pageUrl: "https://login.example.co.uk/x" })).pageDomain,
    ).toBe("example.co.uk");
    expect((await service.listAccounts()).pageDomain).toBeNull();
  });

  it("requires an unlocked vault", async () => {
    const { service } = await unlockedService();
    await service.lock();
    expect(await codeOf(service.listAccounts())).toBe("locked");
    expect(await codeOf(service.addAccount({ uri: `otpauth://totp/x?secret=${SECRET}` }))).toBe(
      "locked",
    );
  });

  it("refreshes the timeout alarm on every interaction", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), {
      kind: "timeout",
      minutes: 15,
    });
    p.clock.advance(10 * 60_000);
    await service.listAccounts();
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(p.clock.now() + 15 * 60_000);
  });

  it("does not postpone the auto-lock for passive polling, but does for real calls", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), {
      kind: "timeout",
      minutes: 15,
    });
    const due = p.alarms.scheduled.get(AUTOLOCK_ALARM)!;
    for (let i = 0; i < 16; i++) {
      p.clock.advance(60_000);
      await service.listAccounts({ passive: true });
    }
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(due);
    expect(p.clock.now()).toBeGreaterThanOrEqual(due);
    await service.handleAlarm(AUTOLOCK_ALARM);
    expect(await codeOf(service.listAccounts({ passive: true }))).toBe("locked");
  });

  it("keeps the vault unlocked while non-passive calls arrive", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), {
      kind: "timeout",
      minutes: 15,
    });
    for (let i = 0; i < 16; i++) {
      p.clock.advance(60_000);
      await service.listAccounts();
    }
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)).toBe(p.clock.now() + 15 * 60_000);
    expect(p.alarms.scheduled.get(AUTOLOCK_ALARM)!).toBeGreaterThan(p.clock.now());
  });

  it("clears the timeout alarm on lock", async () => {
    const { p, service } = await unlockedService(memoryPlatform(), {
      kind: "timeout",
      minutes: 15,
    });
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(true);
    await service.lock();
    expect(p.alarms.scheduled.has(AUTOLOCK_ALARM)).toBe(false);
  });
});

describe("editing", () => {
  it("rejects duplicates and invalid input", async () => {
    const { service } = await unlockedService();
    await service.addAccount({ uri: `otpauth://totp/x?secret=${SECRET}` });
    expect(await codeOf(service.addAccount({ uri: `otpauth://totp/y?secret=${SECRET}` }))).toBe(
      "duplicate-account",
    );
    expect(await codeOf(service.addAccount({ uri: "https://example.com" }))).toBe("invalid-uri");
    expect(await codeOf(service.addAccount({ draft: { secret: "not base32!" } }))).toBe(
      "invalid-base32",
    );
  });

  it("updates, pins, reorders and deletes accounts", async () => {
    const { service } = await unlockedService();
    const a = await service.addAccount({ draft: { secret: SECRET, issuer: "A" } });
    const b = await service.addAccount({ draft: { secret: "GEZDGNBVGY3TQOJQ", issuer: "B" } });
    await service.updateAccount(a.id, { issuer: "A2", domains: ["https://a.example.com"] });
    await service.setPinned(b.id, true);
    await service.reorder([b.id, a.id]);
    let view = await service.listAccounts();
    expect(view.accounts.map((x) => [x.issuer, x.pinned])).toEqual([
      ["B", true],
      ["A2", false],
    ]);
    expect(view.accounts[1]!.domains).toEqual(["example.com"]);
    await service.deleteAccount(b.id);
    view = await service.listAccounts();
    expect(view.accounts.map((x) => x.id)).toEqual([a.id]);
  });

  it("advances HOTP accounts before showing the next code", async () => {
    const { service } = await unlockedService();
    const { id } = await service.addAccount({
      uri: `otpauth://hotp/Bank:me?secret=${SECRET}&counter=4`,
    });
    const expected = await generateCode(
      { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 5 },
      0,
    );
    expect(await service.nextHotp(id)).toEqual({ code: expected.code });
    expect((await service.listAccounts()).accounts[0]!.code).toBe(expected.code);
  });

  it("repairs a damaged index on request", async () => {
    const { p, service } = await unlockedService();
    await service.addAccount({ draft: { secret: SECRET } });
    p.local.data.set("vault:index", { v: 1, iv: "AAAAAAAAAAAAAAAA", ct: "AAAA", updatedAt: 0 });
    expect((await service.listAccounts()).indexDamaged).toBe(true);
    await service.rebuildIndex();
    expect((await service.listAccounts()).indexDamaged).toBe(false);
  });
});
