import { generateCode } from "@otp-vault/core";
import { describe, expect, it } from "vitest";
import { saveSettings } from "../src/background/settings";
import { MIN_FILL_REMAINING_SEC } from "../src/background/vaultService";
import { codeOf, unlockedService } from "./helpers/service";

const SECRET = "JBSWY3DPEHPK3PXP";
const TAB = 1;
const BANK = "https://bank.com/login";

async function setup(opts: { domain?: string; type?: "totp" | "hotp" } = {}) {
  const ctx = await unlockedService();
  const type = opts.type ?? "totp";
  const { id } = await ctx.service.addAccount(
    {
      uri: `otpauth://${type}/Bank:me?secret=${SECRET}&issuer=Bank${type === "hotp" ? "&counter=5" : ""}`,
    },
    opts.domain === undefined ? { sourceUrl: BANK } : opts.domain ? { sourceUrl: opts.domain } : {},
  );
  ctx.p.tabs.activeTab = { id: TAB, url: BANK };
  return { ...ctx, id };
}

const totpNow = (ms: number) =>
  generateCode(
    { type: "totp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 0 },
    ms,
  );

describe("fillCode", () => {
  it("fills a linked account and reports no code", async () => {
    const { p, service, id } = await setup();
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r).toEqual({ result: "filled", code: null });
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]).toMatchObject({ tabId: TAB, explicit: false });
    expect(p.tabs.fills[0]?.code).toBe((await totpNow(p.clock.now())).code);
  });

  it("refuses an unlinked site while fillOnlyLinked is on", async () => {
    const { p, service, id } = await setup();
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(await codeOf(service.fillCode({ id, tabId: TAB, confirmed: true }))).toBe("not-linked");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("asks for confirmation on an unlinked site when fillOnlyLinked is off", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.fillCode({ id, tabId: TAB, confirmed: true })).result).toBe("filled");
    expect(p.tabs.fills).toHaveLength(1);
  });

  it("treats look-alike hosts as unlinked", async () => {
    const { p, service, id } = await setup();
    for (const url of ["https://bank.com.evil.io/", "https://evilbank.com/", "https://bank.co/"]) {
      p.tabs.activeTab = { id: TAB, url };
      expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    }
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("re-reads the tab url at fill time", async () => {
    const { p, service, id } = await setup();
    p.tabs.liveUrl = "https://bank.com.evil.io/";
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("refuses when the tab url is unknown", async () => {
    const { p, service, id } = await setup();
    p.tabs.liveUrl = null;
    expect((await service.fillCode({ id, tabId: TAB })).result).toBe("refused");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("refuses http pages but allows http on localhost", async () => {
    const { p, service, id } = await setup();
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/login" };
    expect((await service.fillCode({ id, tabId: TAB })).result).toBe("refused");
    expect(p.tabs.fills).toHaveLength(0);
    await service.updateAccount(id, { domains: ["localhost"] });
    p.tabs.activeTab = { id: TAB, url: "http://localhost:3000/login" };
    expect((await service.fillCode({ id, tabId: TAB })).result).toBe("filled");
  });

  it("waits for the next code when under two seconds remain", async () => {
    const { p, service, id } = await setup();
    // 29 s into the period: 1 s remaining.
    p.clock.ms = Math.floor(p.clock.ms / 30_000) * 30_000 + 29_000;
    const before = (await totpNow(p.clock.now())).code;
    expect(MIN_FILL_REMAINING_SEC).toBe(2);
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r.result).toBe("filled");
    const typed = p.tabs.fills[0]?.code;
    expect(typed).toBe((await totpNow(p.clock.now())).code);
    expect(typed).not.toBe(before);
  });

  it("increments an HOTP counter exactly once per fill", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    await service.fillCode({ id, tabId: TAB });
    const view = await service.listAccounts();
    const expected = await generateCode(
      { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 6 },
      0,
    );
    expect(view.accounts[0]?.code).toBe(expected.code);
    expect(p.tabs.fills[0]?.code).toBe(
      (
        await generateCode(
          { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 6 },
          0,
        )
      ).code,
    );
  });

  it("returns the code for copying when the page has no field", async () => {
    const { p, service, id } = await setup();
    p.tabs.next = "no-field";
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r.result).toBe("copied-instead");
    expect(r.code).toBe(p.tabs.fills[0]?.code);
  });

  it("returns the code for copying when the page refuses scripts", async () => {
    const { p, service, id } = await setup();
    p.tabs.next = null;
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r.result).toBe("refused");
    expect(r.code).toBe(p.tabs.fills[0]?.code);
  });

  it("reports not-found for an unknown account", async () => {
    const { service } = await setup();
    expect(await codeOf(service.fillCode({ id: "nope", tabId: TAB }))).toBe("not-found");
  });

  it("is locked when the vault is locked", async () => {
    const { service, id } = await setup();
    await service.lock();
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("locked");
  });

  it("never sends the secret to the page", async () => {
    const { p, service, id } = await setup();
    await service.fillCode({ id, tabId: TAB });
    for (const f of p.tabs.fills) {
      expect(f.code).toMatch(/^[0-9A-Z]{4,10}$/);
      expect(JSON.stringify(f)).not.toContain(SECRET);
    }
  });
});

describe("site memory", () => {
  it("remembers the site after a fill when site memory is on, but never authorises a fill", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    await service.fillCode({ id, tabId: TAB, confirmed: true });
    const view = await service.listAccounts({ pageUrl: "https://other.com/x" });
    expect(view.matches.exact).toEqual([]);
    expect(view.matches.remembered).toEqual([id]);
    // The shortcut uses account domains only.
    p.tabs.fills.length = 0;
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badge).toBe("");
    expect(p.tabs.badges).toContain("?");
  });

  it("does not remember after a failed fill or when the setting is off", async () => {
    const { p, service, id } = await setup();
    p.tabs.next = "no-field";
    await service.fillCode({ id, tabId: TAB });
    expect((await service.listAccounts({ pageUrl: BANK })).matches.remembered).toEqual([]);
    p.tabs.next = "filled";
    await service.setSiteMemory(false);
    await service.fillCode({ id, tabId: TAB });
    await service.setSiteMemory(true);
    p.tabs.activeTab = { id: TAB, url: "https://app.bank.com/" };
    expect((await service.listAccounts({ pageUrl: BANK })).matches.remembered).toEqual([]);
  });

  it("keeps ordering hints out of the exact list", async () => {
    const { service, id } = await setup();
    await service.fillCode({ id, tabId: TAB });
    const view = await service.listAccounts({ pageUrl: BANK });
    expect(view.matches.exact).toEqual([id]);
    expect(view.matches.remembered).toEqual([]);
  });

  it("forgets all sites when site memory is turned off", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    await service.fillCode({ id, tabId: TAB, confirmed: true });
    await service.setSiteMemory(false);
    await service.setSiteMemory(true);
    expect(
      (await service.listAccounts({ pageUrl: "https://other.com/" })).matches.remembered,
    ).toEqual([]);
  });

  it("clears memory on the next unlock when it was turned off while locked", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    await service.fillCode({ id, tabId: TAB, confirmed: true });
    await service.lock();
    await service.setSiteMemory(false);
    await service.setSiteMemory(true);
    await service.unlock("correct horse battery");
    expect(
      (await service.listAccounts({ pageUrl: "https://other.com/" })).matches.remembered,
    ).toEqual([]);
  });

  it("still reports filled when remembering fails", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    const real = p.local.set.bind(p.local);
    const orig = p.local.set;
    // The vault lives in local storage here: make only the site-memory write fail.
    p.local.set = async (items: Record<string, unknown>) => {
      if (Object.keys(items).some((k) => k.includes("sitemem"))) throw new Error("QUOTA_BYTES");
      return real(items);
    };
    const r = await service.fillCode({ id, tabId: TAB, confirmed: true });
    p.local.set = orig;
    expect(r.result).toBe("filled");
    expect(p.tabs.fills).toHaveLength(1);
  });
});

describe("settings", () => {
  it("defaults both on and exposes them in state", async () => {
    const { service } = await setup();
    const s = await service.getState();
    expect(s.fillOnlyLinked).toBe(true);
    expect(s.siteMemory).toBe(true);
    await service.setFillOnlyLinked(false);
    await service.setSiteMemory(false);
    const t = await service.getState();
    expect([t.fillOnlyLinked, t.siteMemory]).toEqual([false, false]);
  });

  it("falls back to defaults for corrupt stored values", async () => {
    const { p, service } = await setup();
    await saveSettings(p.local, {});
    const stored = (await p.local.get(["settings"])).settings as Record<string, unknown>;
    await p.local.set({ settings: { ...stored, fillOnlyLinked: "x", siteMemory: 3 } });
    const s = await service.getState();
    expect([s.fillOnlyLinked, s.siteMemory]).toEqual([true, true]);
  });
});

describe("command", () => {
  it("fills the single matching account", async () => {
    const { p, service } = await setup();
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]?.explicit).toBe(false);
    expect(p.tabs.badges).toEqual([]);
  });

  it("opens the popup as its first action when locked, and badges when it cannot", async () => {
    const { p, service } = await setup();
    await service.lock();
    p.tabs.calls.length = 0;
    await service.fillFromCommand();
    expect(p.tabs.calls[0]).toBe("openPopup");
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual([]);
    p.tabs.popupOpens = false;
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["?", ""]);
  });

  it("badges ? for no match and for an ambiguous match, then clears after 3 s", async () => {
    const { p, service } = await setup();
    p.tabs.activeTab = { id: TAB, url: "https://nothing.example/" };
    const t0 = p.clock.now();
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["?", ""]);
    expect(p.clock.now() - t0).toBeGreaterThanOrEqual(3000);
    p.tabs.badges.length = 0;
    await service.addAccount(
      { uri: `otpauth://totp/Bank2:me?secret=GEZDGNBVGY3TQOJQ&issuer=Bank2` },
      { sourceUrl: BANK },
    );
    p.tabs.activeTab = { id: TAB, url: BANK };
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["?", ""]);
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("badges ! when the fill fails", async () => {
    const { p, service } = await setup();
    p.tabs.next = "no-field";
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("badges ? on a page that is not https", async () => {
    const { p, service } = await setup();
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/" };
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["?", ""]);
  });

  it("does nothing without an active tab", async () => {
    const { p, service } = await setup();
    p.tabs.activeTab = null;
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["?", ""]);
  });
});

describe("menu", () => {
  it("fills into the clicked frame with explicit set", async () => {
    const { p, service } = await setup();
    await service.fillFromMenu({ id: TAB, url: BANK }, 0, undefined);
    expect(p.tabs.fills[0]).toMatchObject({ tabId: TAB, frameId: 0, explicit: true });
  });

  it("fills a same-site subframe", async () => {
    const { p, service } = await setup();
    await service.fillFromMenu({ id: TAB, url: BANK }, 7, "https://login.bank.com/frame");
    expect(p.tabs.fills[0]).toMatchObject({ frameId: 7, explicit: true });
  });

  it("refuses a cross-origin frame", async () => {
    const { p, service, id } = await setup();
    // Even a frame the account is linked to must share the tab's registrable domain.
    await service.updateAccount(id, { domains: ["bank.com", "evil.io"] });
    await service.fillFromMenu({ id: TAB, url: BANK }, 7, "https://evil.io/frame");
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["!", ""]);
    await service.updateAccount(id, { domains: ["bank.com"] });
    p.tabs.badges.length = 0;
    await service.fillFromMenu({ id: TAB, url: BANK }, 7, "https://evil.io/frame");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("refuses a subframe without a frame url", async () => {
    const { p, service } = await setup();
    await service.fillFromMenu({ id: TAB, url: BANK }, 7, undefined);
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("refuses http pages", async () => {
    const { p, service } = await setup();
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/" };
    await service.fillFromMenu({ id: TAB, url: "http://bank.com/" }, 0, undefined);
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("opens the popup when locked", async () => {
    const { p, service } = await setup();
    await service.lock();
    await service.fillFromMenu({ id: TAB, url: BANK }, 0, undefined);
    expect(p.tabs.popupOpened).toBe(1);
  });
});
