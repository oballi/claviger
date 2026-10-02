import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "@otp-vault/core";
import config from "../wxt.config";

type ManifestFn = (env: {
  browser: string;
  manifestVersion: number;
  mode: string;
  command: string;
}) => Record<string, unknown>;

const manifestFor = (browser: string) =>
  (config.manifest as ManifestFn)({
    browser,
    manifestVersion: 3,
    mode: "production",
    command: "build",
  });

const versionOf = (path: string) =>
  (JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { version: string }).version;

describe("manifest", () => {
  it.each(["chrome", "firefox"])("declares the spec's CSP for %s", (browser) => {
    const manifest = manifestFor(browser);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    });
  });

  it.each(["chrome", "firefox"])("asks for the clock source only as optional for %s", (browser) => {
    const manifest = manifestFor(browser);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.optional_host_permissions).toEqual(["https://www.google.com/*"]);
  });

  it.each(["chrome", "firefox"])("keeps <all_urls> out of the normal %s build", (browser) => {
    expect(JSON.stringify(manifestFor(browser))).not.toContain("<all_urls>");
  });

  it("declares clipboard permissions per browser", () => {
    const base = [
      "storage",
      "alarms",
      "idle",
      "activeTab",
      "scripting",
      "clipboardWrite",
      "contextMenus",
    ];
    expect(manifestFor("chrome").permissions).toEqual([...base, "offscreen"]);
    expect(manifestFor("firefox").permissions).toEqual(base);
  });

  it.each(["chrome", "firefox"])("declares the fill shortcut for %s", (browser) => {
    expect(manifestFor(browser).commands).toEqual({
      "fill-code": {
        suggested_key: { default: "Alt+Shift+O" },
        description: "__MSG_commandFill__",
      },
    });
  });

  it("pins the Firefox add-on id and minimum version", () => {
    expect(manifestFor("firefox").browser_specific_settings).toEqual({
      gecko: {
        id: "otp-vault@otp-vault.dev",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
    });
    expect(manifestFor("firefox").minimum_chrome_version).toBeUndefined();
  });

  it("pins the minimum Chrome version", () => {
    expect(manifestFor("chrome").minimum_chrome_version).toBe("116");
    expect(manifestFor("chrome").browser_specific_settings).toBeUndefined();
  });

  it("localizes the name and description and leaves the version to package.json", () => {
    const manifest = manifestFor("chrome");
    expect(manifest.name).toBe("__MSG_extName__");
    expect(manifest.description).toBe("__MSG_extDescription__");
    expect(manifest.default_locale).toBe("en");
    expect(manifest.version).toBeUndefined();
  });

  it("keeps one version across the repo", () => {
    const root = versionOf("../../../package.json");
    expect(versionOf("../package.json")).toBe(root);
    expect(versionOf("../../../packages/core/package.json")).toBe(root);
    expect(CORE_VERSION).toBe(root);
  });

  it("defines the menu and command strings in every locale", () => {
    for (const lang of ["en", "tr"]) {
      const messages = JSON.parse(
        readFileSync(new URL(`../public/_locales/${lang}/messages.json`, import.meta.url), "utf8"),
      ) as Record<string, { message: string }>;
      expect(messages.menuFill?.message).toBeTruthy();
      expect(messages.commandFill?.message).toBeTruthy();
    }
  });

  it("has the same message keys in every locale", () => {
    const keys = (lang: string) =>
      Object.keys(
        JSON.parse(
          readFileSync(
            new URL(`../public/_locales/${lang}/messages.json`, import.meta.url),
            "utf8",
          ),
        ) as object,
      ).sort();
    expect(keys("tr")).toEqual(keys("en"));
  });

  it("ships square PNG icons in every size WXT auto-detects", () => {
    for (const size of [16, 32, 48, 128]) {
      const png = readFileSync(new URL(`../public/icon/${size}.png`, import.meta.url));
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
    }
  });

  it.each(["chrome", "firefox"])("points the toolbar action at the icons for %s", (browser) => {
    const icons = {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    };
    const manifest = manifestFor(browser);
    expect(manifest.icons).toEqual(icons);
    expect((manifest.action as { default_icon: unknown }).default_icon).toEqual(icons);
  });

  it("keeps the source SVGs next to the generator", () => {
    for (const name of ["icon.svg", "icon-16.svg"]) {
      const svg = readFileSync(new URL(`../assets/${name}`, import.meta.url), "utf8");
      expect(svg).toContain('viewBox="0 0 32 32"');
      expect(svg).toContain("#19191B");
    }
  });
});
