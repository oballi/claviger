import { generateCode } from "@claviger/core";
import { describe, expect, it, vi } from "vitest";
import { handleUserTrigger } from "../src/background/triggers";
import { MIN_FILL_REMAINING_SEC, VaultService } from "../src/background/vaultService";
import { PASSWORD, unlockedService } from "./helpers/service";

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

describe("fill from the active tab", () => {
  const hotpAt = async (counter: number) =>
    (
      await generateCode(
        { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter },
        0,
      )
    ).code;

  it("fills a linked account", async () => {
    const { p, service } = await setup();
    expect(await service.fillFromCommand()).toBe("done");
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]).toMatchObject({ tabId: TAB, explicit: false });
    expect(p.tabs.fills[0]?.code).toBe((await totpNow(p.clock.now())).code);
    expect(p.tabs.fills[0]?.expectedDomain).toBe("bank.com");
    expect(p.tabs.badges).toEqual([]);
  });

  it("badges ! when the page answers wrong-site", async () => {
    const { p, service } = await setup();
    p.tabs.next = "wrong-site";
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("re-reads the tab url again after the wait, right before injecting", async () => {
    const { p, service } = await setup();
    const urls = [BANK, "https://evil.io/"];
    p.tabs.url = async () => urls.shift() ?? "https://evil.io/";
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("refuses when the second read shows a non-https page", async () => {
    const { p, service } = await setup();
    const urls = [BANK, "http://bank.com/"];
    p.tabs.url = async () => urls.shift() ?? "http://bank.com/";
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("does not advance HOTP when the first check refuses", async () => {
    const { p, service } = await setup({ type: "hotp" });
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/" };
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.listAccounts()).accounts[0]?.code).toBe(await hotpAt(5));
  });

  it("an unlinked account is never filled and never burns an HOTP counter", async () => {
    const { p, service } = await setup({ type: "hotp" });
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.listAccounts()).accounts[0]?.code).toBe(await hotpAt(5));
  });

  it("does not advance HOTP when the tab navigates to an unlinked site before injection", async () => {
    const { p, service } = await setup({ type: "hotp" });
    p.tabs.liveUrl = "https://bank.com.evil.io/";
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.listAccounts()).accounts[0]?.code).toBe(await hotpAt(5));
  });

  it("treats look-alike hosts as unlinked", async () => {
    const { p, service } = await setup();
    for (const url of ["https://bank.com.evil.io/", "https://evilbank.com/", "https://bank.co/"]) {
      p.tabs.activeTab = { id: TAB, url };
      await service.fillFromCommand();
    }
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("never lists or fills an account only because the page host looks like its domain", async () => {
    const { p, service } = await setup();
    const evil = "https://bank.com.evil.io/";
    p.tabs.activeTab = { id: TAB, url: evil };
    const view = await service.listAccounts({ pageUrl: evil });
    expect(view.matches).toEqual({ exact: [] });
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("re-reads the tab url at fill time", async () => {
    const { p, service } = await setup();
    p.tabs.liveUrl = "https://bank.com.evil.io/";
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("refuses when the tab url is unknown", async () => {
    const { p, service } = await setup();
    p.tabs.liveUrl = null;
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toEqual(["!", ""]);
  });

  it("refuses http pages but allows http on localhost", async () => {
    const { p, service, id } = await setup();
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/login" };
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(0);
    await service.updateAccount(id, { domains: ["localhost"] });
    p.tabs.activeTab = { id: TAB, url: "http://localhost:3000/login" };
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
  });

  it("waits for the next code when under two seconds remain", async () => {
    const { p, service } = await setup();
    // 28.5 s into the period: 1.5 s remaining.
    p.clock.ms = Math.floor(p.clock.ms / 30_000) * 30_000 + 28_500;
    const before = (await totpNow(p.clock.now())).code;
    expect(MIN_FILL_REMAINING_SEC).toBe(2);
    await service.fillFromCommand();
    const typed = p.tabs.fills[0]?.code;
    expect(typed).toBe((await totpNow(p.clock.now())).code);
    expect(typed).not.toBe(before);
  });

  it("does not wait when two seconds or more remain", async () => {
    const { p, service } = await setup();
    p.clock.ms = Math.floor(p.clock.ms / 30_000) * 30_000 + 27_900;
    const t0 = p.clock.now();
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.clock.now()).toBe(t0);
  });

  it("increments an HOTP counter exactly once per fill", async () => {
    const { p, service } = await setup({ type: "hotp" });
    await service.fillFromCommand();
    expect((await service.listAccounts()).accounts[0]?.code).toBe(await hotpAt(6));
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]?.code).toBe(await hotpAt(6));
  });

  it("badges ! when the page has no field or refuses scripts", async () => {
    const { p, service } = await setup();
    p.tabs.next = "no-field";
    await service.fillFromCommand();
    p.tabs.next = null;
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["!", "", "!", ""]);
  });

  it("the menu path fills the same single linked account for the clicked tab", async () => {
    const { p, service } = await setup();
    await service.fillFromMenu({ id: TAB, url: BANK }, 0, undefined);
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]?.code).toBe((await totpNow(p.clock.now())).code);
  });

  it("never sends the secret to the page", async () => {
    const { p, service } = await setup();
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
    for (const f of p.tabs.fills) {
      expect(f.code).toMatch(/^[0-9A-Z]{4,10}$/);
      expect(JSON.stringify(f)).not.toContain(SECRET);
    }
  });
});

describe("legacy site memory", () => {
  const KEY = "vault:sitemem";
  const stored = async (p: Awaited<ReturnType<typeof setup>>["p"]) =>
    (await p.local.get([KEY]))[KEY];

  it("removes a stored record on unlock, again when it reappears, and never writes one", async () => {
    const { p, service } = await setup();
    await p.local.set({ [KEY]: { v: 1, data: "legacy" } });
    await service.lock();
    await service.unlock(PASSWORD);
    expect(await stored(p)).toBeUndefined();
    await service.fillFromCommand();
    expect(await stored(p)).toBeUndefined();
    // A record that comes back later (for example via sync) is purged on the next unlock too.
    await p.local.set({ [KEY]: { v: 1, data: "again" } });
    await service.lock();
    await service.unlock(PASSWORD);
    expect(await stored(p)).toBeUndefined();
  });

  it("an unlock on a clean vault never calls storage.remove for the record", async () => {
    const { p, service } = await setup();
    await service.lock();
    const remove = vi.spyOn(p.local, "remove");
    await service.unlock(PASSWORD);
    expect(remove.mock.calls.flatMap((c) => c[0] as string[])).not.toContain(KEY);
  });

  it("removes a stored record when the vault loads from the cached key", async () => {
    const { p } = await unlockedService(undefined, { kind: "never" });
    await p.local.set({ [KEY]: { v: 1, data: "legacy" } });
    expect((await new VaultService(p).getState()).status).toBe("unlocked");
    expect(await stored(p)).toBeUndefined();
  });

  it("removes a stored record on recovery unlock", async () => {
    const { p, service, recoveryCode } = await unlockedService();
    await service.lock();
    await p.local.set({ [KEY]: { v: 1, data: "legacy" } });
    await service.unlockWithRecovery(recoveryCode!, "another password 1");
    expect(await stored(p)).toBeUndefined();
  });

  it("reads siteMemoryClearPending first and only removes it when present", async () => {
    const { p } = await unlockedService(undefined, { kind: "never" });
    const remove = vi.spyOn(p.local, "remove");
    await new VaultService(p).getState();
    expect(remove.mock.calls.flatMap((c) => c[0] as string[])).not.toContain(
      "siteMemoryClearPending",
    );
    await p.local.set({ siteMemoryClearPending: true });
    await new VaultService(p).getState();
    expect(remove.mock.calls.flatMap((c) => c[0] as string[])).toContain("siteMemoryClearPending");
  });

  it("a failing storage read never fails an unlock", async () => {
    const { p, service } = await setup();
    await p.local.set({ [KEY]: "garbage" });
    await service.lock();
    const get = p.local.get.bind(p.local);
    vi.spyOn(p.local, "get").mockImplementation(async (keys?: string[]) => {
      if (keys?.length === 1 && keys[0] === KEY) throw new Error("boom");
      return get(keys as string[]);
    });
    await expect(service.unlock(PASSWORD)).resolves.toBeUndefined();
    expect((await service.getState()).status).toBe("unlocked");
  });
});

describe("settings", () => {
  it("getState has no fillOnlyLinked or siteMemory keys", async () => {
    const { p, service } = await setup();
    await p.local.set({ settings: { fillOnlyLinked: false, siteMemory: false } });
    const s = await service.getState();
    expect("fillOnlyLinked" in s).toBe(false);
    expect("siteMemory" in s).toBe(false);
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

  it("an unlinked account matching only by name is never filled: badge ? and zero fills", async () => {
    const { p, service } = await setup({ domain: "" });
    await service.fillFromCommand();
    expect(p.tabs.badges).toEqual(["?", ""]);
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("fills the linked account when an unlinked one is also named like the site", async () => {
    const { p, service } = await setup();
    await service.addAccount({
      uri: "otpauth://totp/Bank:other?secret=GEZDGNBVGY3TQOJQ&issuer=Bank",
    });
    await service.fillFromCommand();
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]?.code).toBe((await totpNow(p.clock.now())).code);
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

  it("matches by registrable domain: a multi-label suffix is fine, a look-alike is not", async () => {
    const { p, service } = await setup({ domain: "https://example.co.uk/" });
    const page = "https://www.example.co.uk/";
    p.tabs.activeTab = { id: TAB, url: page };
    await service.fillFromMenu({ id: TAB, url: page }, 7, "https://login.example.co.uk/");
    expect(p.tabs.fills).toHaveLength(1);
    p.tabs.fills.length = 0;
    await service.fillFromMenu({ id: TAB, url: "https://evil-example.co.uk/" }, 0, undefined);
    expect(p.tabs.fills).toHaveLength(0);
    expect(p.tabs.badges).toContain("?");
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

describe("fillAccount (popup picks the account)", () => {
  it("fills a linked account on an https tab and returns no code", async () => {
    const { p, service, id } = await setup();
    const r = await service.fillAccount(id, TAB);
    expect(r).toEqual({ result: "filled", code: null });
    expect(p.tabs.fills).toHaveLength(1);
    expect(p.tabs.fills[0]).toMatchObject({
      tabId: TAB,
      explicit: true,
      expectedDomain: "bank.com",
    });
  });

  it("refuses an unlinked account with not-linked, fills nothing and keeps the HOTP counter", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    p.tabs.activeTab = { id: TAB, url: "https://other.com/" };
    await expect(service.fillAccount(id, TAB)).rejects.toMatchObject({ code: "not-linked" });
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.listAccounts()).accounts[0]?.code).toBe(
      (
        await generateCode(
          { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 5 },
          0,
        )
      ).code,
    );
  });

  it("refuses a plain http page without a code and without burning HOTP", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    p.tabs.activeTab = { id: TAB, url: "http://bank.com/" };
    const r = await service.fillAccount(id, TAB);
    expect(r).toEqual({ result: "refused", code: null });
    expect(p.tabs.fills).toHaveLength(0);
    expect((await service.listAccounts()).accounts[0]?.code).toBe(
      (
        await generateCode(
          { type: "hotp", secret: SECRET, algorithm: "SHA1", digits: 6, period: 30, counter: 5 },
          0,
        )
      ).code,
    );
  });

  it("re-reads the tab url instead of trusting the caller", async () => {
    const { p, service, id } = await setup();
    p.tabs.liveUrl = "https://bank.com.evil.io/";
    await expect(service.fillAccount(id, TAB)).rejects.toMatchObject({ code: "not-linked" });
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("is refused while the vault is locked", async () => {
    const { p, service, id } = await setup();
    await service.lock();
    await expect(service.fillAccount(id, TAB)).rejects.toMatchObject({ code: "locked" });
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("only hands a code back when the page had no field", async () => {
    const { p, service, id } = await setup();
    p.tabs.next = "no-field";
    const r = await service.fillAccount(id, TAB);
    expect(r.result).toBe("copied-instead");
    expect(r.code).toBe((await totpNow(p.clock.now())).code);
    p.tabs.next = "wrong-site";
    expect(await service.fillAccount(id, TAB)).toEqual({ result: "refused", code: null });
  });

  it("hands the advanced HOTP code back when the second check navigates away", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    const urls = [BANK, "https://evil.io/"];
    p.tabs.url = async () => urls.shift() ?? "https://evil.io/";
    const r = await service.fillAccount(id, TAB);
    expect(r.result).toBe("copied-instead");
    expect(r.code).toMatch(/^\d{6}$/);
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("hands the advanced HOTP code back when the second check is not-linked", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    const urls = [BANK, "https://other.com/"];
    p.tabs.url = async () => urls.shift() ?? "https://other.com/";
    const r = await service.fillAccount(id, TAB);
    expect(r.result).toBe("copied-instead");
    expect(r.code).toMatch(/^\d{6}$/);
  });

  it("hands the advanced HOTP code back when the page answers wrong-site", async () => {
    const { p, service, id } = await setup({ type: "hotp" });
    p.tabs.next = "wrong-site";
    const r = await service.fillAccount(id, TAB);
    expect(r.result).toBe("copied-instead");
    expect(r.code).toMatch(/^\d{6}$/);
  });

  it("throws locked when the vault locks between the second check and the injection", async () => {
    const { p, service, id } = await setup();
    const real = p.tabs.url.bind(p.tabs);
    let calls = 0;
    p.tabs.url = async (t: number) => {
      calls += 1;
      const u = await real(t);
      if (calls === 2) await service.lock();
      return u;
    };
    await expect(service.fillAccount(id, TAB)).rejects.toMatchObject({ code: "locked" });
    expect(p.tabs.fills).toHaveLength(0);
  });

  it("throws not-found for an unknown account", async () => {
    const { service } = await setup();
    await expect(service.fillAccount("nope", TAB)).rejects.toMatchObject({ code: "not-found" });
  });
});
