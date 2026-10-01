import { beforeEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createBrowserPlatform, storagePort } from "../src/platform/browserPlatform";

beforeEach(() => {
  fakeBrowser.reset();
});

describe("storagePort", () => {
  it("reads, writes and removes items", async () => {
    const port = storagePort(browser.storage.local);
    await port.set({ a: 1, b: { c: "x" } });
    expect(await port.get(["a"])).toEqual({ a: 1 });
    expect(await port.get()).toEqual({ a: 1, b: { c: "x" } });
    await port.remove(["a"]);
    expect(await port.get()).toEqual({ b: { c: "x" } });
  });

  it("omits missing keys", async () => {
    expect(await storagePort(browser.storage.local).get(["missing"])).toEqual({});
  });
});

describe("createBrowserPlatform", () => {
  it("keeps local, sync and session separate", async () => {
    const platform = createBrowserPlatform();
    await platform.local.set({ k: "local" });
    await platform.sync.set({ k: "sync" });
    await platform.session.set({ k: "session" });
    expect(await platform.local.get()).toEqual({ k: "local" });
    expect(await platform.sync.get()).toEqual({ k: "sync" });
    expect(await platform.session.get()).toEqual({ k: "session" });
  });

  it("creates and clears alarms", async () => {
    const platform = createBrowserPlatform();
    await platform.alarms.create("autolock", 15);
    expect(await browser.alarms.get("autolock")).toMatchObject({ name: "autolock" });
    await platform.alarms.clear("autolock");
    expect(await browser.alarms.get("autolock")).toBeUndefined();
  });

  it("uses the real clock and WebCrypto randomness", () => {
    const platform = createBrowserPlatform();
    expect(Math.abs(platform.clock.now() - Date.now())).toBeLessThan(1000);
    expect(platform.random.bytes(16)).toHaveLength(16);
    expect(platform.kdf).toBeUndefined();
  });
});
