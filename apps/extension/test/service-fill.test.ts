import { generateCode } from "@otp-vault/core";
import { describe, expect, it, vi } from "vitest";
import { handleUserTrigger } from "../src/background/triggers";
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
  it("fills a linked account and remembers nothing new for an already linked domain", async () => {
    const { p, service, id } = await setup();
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r).toEqual({ result: "filled", code: null });
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]).toMatchObject({ tabId: TAB, explicit: false });
    expect(p.tabs.fills[0]?.code).toBe((await totpNow(p.clock.now())).code);
    expect(p.tabs.fills[0]?.expectedDomain).toBe("bank.com");
    const vault = (service as unknown as { vault: { getSiteMemory(): Promise<object> } }).vault;
    expect(await vault.getSiteMemory()).toEqual({});
  });

  it("refuses a tab that is not the active one", async () => {
    const { p, service, id } = await setup();
    expect(await codeOf(service.fillCode({ id, tabId: 99 }))).toBe("invalid-request");
    p.tabs.activeTab = null;
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("invalid-request");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("binds a confirmation to the domain the user saw", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    expect(await codeOf(service.fillCode({ id, tabId: TAB, confirmedDomain: "bank.com" }))).toBe(
      "not-linked",
    );
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("treats a wrong-site answer from the page as refused and writes no memory", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    p.tabs.next = "wrong-site";
    const r = await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" });
    expect(r.result).toBe("refused");
    expect(r.code).toBe(p.tabs.fills[0]?.code);
    p.tabs.next = "filled";
    expect(
      (await service.listAccounts({ pageUrl: "https://other.com/" })).matches.remembered,
    ).toEqual([]);
  });

  it("re-reads the tab url again after the wait, right before injecting", async () => {
    const { p, service, id } = await setup();
    const urls = [BANK, "https://evil.io/"];
    p.tabs.url = async () => urls.shift() ?? "https://evil.io/";
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("refuses when the second read shows a non-https page", async () => {
    const { p, service, id } = await setup();
    const urls = [BANK, "http://bank.com/"];
    p.tabs.url = async () => urls.shift() ?? "http://bank.com/";
    expect((await service.fillCode({ id, tabId: TAB })).result).toBe("refused");
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("does not advance HOTP when the first check refuses", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/" };
    await service.fillCode({ id, tabId: TAB });
    const view = await service.listAccounts();
    const c5 = await generateCode(
      { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 5 },
      0,
    );
    expect(view.accounts[0]?.code).toBe(c5.code);
  });

  it("refuses an unlinked site while fillOnlyLinked is on", async () => {
    const { p, service, id } = await setup();
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(await codeOf(service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" }))).toBe(
      "not-linked",
    );
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("asks for confirmation on an unlinked site when fillOnlyLinked is off", async () => {
    const { p, service, id } = await setup();
    await service.setFillOnlyLinked(false);
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" })).result).toBe(
      "filled",
    );
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

  it("never fills an account that is only suggested for the page", async () => {
    const { p, service, id } = await setup();
    const evil = "https://bank.com.evil.io/";
    p.tabs.activeTab = { id: TAB, url: evil };
    const view = await service.listAccounts({ pageUrl: evil });
    expect(view.matches.exact).toEqual([]);
    expect(view.matches.suggested).toEqual([id]);
    expect(await codeOf(service.fillCode({ id, tabId: TAB }))).toBe("not-linked");
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
    // 28.5 s into the period: 1.5 s remaining.
    p.clock.ms = Math.floor(p.clock.ms / 30_000) * 30_000 + 28_500;
    const before = (await totpNow(p.clock.now())).code;
    expect(MIN_FILL_REMAINING_SEC).toBe(2);
    const r = await service.fillCode({ id, tabId: TAB });
    expect(r.result).toBe("filled");
    const typed = p.tabs.fills[0]?.code;
    expect(typed).toBe((await totpNow(p.clock.now())).code);
    expect(typed).not.toBe(before);
  });

  it("does not wait when two seconds or more remain", async () => {
    const { p, service, id } = await setup();
    p.clock.ms = Math.floor(p.clock.ms / 30_000) * 30_000 + 27_900;
    const t0 = p.clock.now();
    await service.fillCode({ id, tabId: TAB });
    expect(p.clock.now()).toBe(t0);
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
    await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" });
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
    await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" });
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
    await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" });
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
    const r = await service.fillCode({ id, tabId: TAB, confirmedDomain: "other.com" });
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

  it("does nothing itself when locked (the listener opens the popup)", async () => {
    const { p, service } = await setup();
    await service.lock();
    p.tabs.calls.length = 0;
    await service.fillFromCommand();
    expect(p.tabs.calls).toEqual([]);
    expect(p.tabs.fills).toHaveLength(0);
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

  it("does nothing itself when locked", async () => {
    const { p, service } = await setup();
    await service.lock();
    await service.fillFromMenu({ id: TAB, url: BANK }, 0, undefined);
    expect(p.tabs.calls).toEqual([]);
  });
});

describe("user trigger", () => {
  it("firefox: opens the popup synchronously, before any storage access, when locked in memory", async () => {
    const { p, service } = await setup();
    await service.lock();
    const order: string[] = [];
    const get = p.session.get.bind(p.session);
    p.session.get = (async (k?: string[]) => {
      order.push("storage");
      return get(k as string[]);
    }) as typeof p.session.get;
    p.tabs.openPopup = async () => {
      order.push("openPopup");
      return true;
    };
    const done = handleUserTrigger(service, p.tabs, () => service.fillFromCommand(), true);
    // Nothing has been awaited yet: the popup request is already made.
    expect(order).toEqual(["openPopup"]);
    await done;
    expect(order[0]).toBe("openPopup");
  });

  it("firefox: does not open the popup when unlocked, and badges when opening fails", async () => {
    const { p, service } = await setup();
    await handleUserTrigger(service, p.tabs, async () => undefined, true);
    expect(p.tabs.popupOpened).toBe(0);
    await service.lock();
    p.tabs.popupOpens = false;
    await handleUserTrigger(service, p.tabs, async () => undefined, true);
    await new Promise((r) => setTimeout(r, 0));
    expect(p.tabs.badges).toEqual(["?", ""]);
  });

  it("firefox: swallows a rejected openPopup", async () => {
    const { p, service } = await setup();
    await service.lock();
    p.tabs.openPopup = async () => {
      throw new Error("no gesture");
    };
    await expect(
      handleUserTrigger(service, p.tabs, async () => undefined, true),
    ).resolves.toBeUndefined();
  });

  it("chrome: does not open the popup when the service fills, even if not unlocked in memory", async () => {
    const { p, service } = await setup();
    // Simulates a suspended worker: memory is empty but the cached key still loads the vault.
    vi.spyOn(service, "isUnlockedInMemory").mockReturnValue(false);
    await handleUserTrigger(service, p.tabs, () => service.fillFromCommand(), false);
    expect(p.tabs.popupOpened).toBe(0);
  });

  it("chrome: opens the popup only after the service reports locked", async () => {
    const { p, service } = await setup();
    await service.lock();
    const order: string[] = [];
    p.tabs.openPopup = async () => {
      order.push("openPopup");
      return true;
    };
    const done = handleUserTrigger(
      service,
      p.tabs,
      async () => {
        order.push("run");
        return "locked";
      },
      false,
    );
    expect(order).toEqual(["run"]);
    await done;
    expect(order).toEqual(["run", "openPopup"]);
  });

  it("chrome: badges when opening fails and swallows a rejection", async () => {
    const { p, service } = await setup();
    await service.lock();
    p.tabs.popupOpens = false;
    await handleUserTrigger(service, p.tabs, async () => "locked", false);
    expect(p.tabs.badges[0]).toBe("?");
    p.tabs.openPopup = async () => {
      throw new Error("x");
    };
    await expect(
      handleUserTrigger(service, p.tabs, async () => "locked", false),
    ).resolves.toBeUndefined();
  });
});
