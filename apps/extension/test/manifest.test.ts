import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORE_VERSION } from "@claviger/core";
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
    expect((manifestFor(browser).commands as Record<string, unknown>)["fill-code"]).toEqual({
      suggested_key: { default: "Alt+Shift+O" },
      description: "__MSG_commandFill__",
    });
  });

  it.each(["chrome", "firefox"])(
    "declares a lock command without a suggested key for %s",
    (browser) => {
      const commands = manifestFor(browser).commands as Record<
        string,
        { suggested_key?: unknown; description: string }
      >;
      expect(commands["lock-vault"]).toEqual({ description: "__MSG_commandLock__" });
      expect(Object.values(commands).filter((c) => c.suggested_key).length).toBeLessThanOrEqual(4);
    },
  );

  it("has a commandLock string in both locales", () => {
    for (const [lang, text] of [
      ["en", "Lock the vault"],
      ["tr", "Kasay\u0131 kilitle"],
    ] as const) {
      const m = JSON.parse(
        readFileSync(new URL(`../public/_locales/${lang}/messages.json`, import.meta.url), "utf8"),
      );
      expect(m.commandLock.message).toBe(text);
    }
  });

  it("uses the claviger name, tagline and Firefox id", () => {
    for (const [lang, desc, menu] of [
      ["en", "Open Source 2FA Authenticator", "Fill with claviger"],
      ["tr", "A\u00e7\u0131k kaynak 2FA do\u011frulay\u0131c\u0131", "claviger ile doldur"],
    ] as const) {
      const m = JSON.parse(
        readFileSync(new URL(`../public/_locales/${lang}/messages.json`, import.meta.url), "utf8"),
      );
      expect(m.extName.message).toBe("claviger");
      expect(m.extDescription.message).toBe(desc);
      expect(m.menuFill.message).toBe(menu);
    }
  });

  it("pins the Firefox add-on id and minimum version", () => {
    expect(manifestFor("firefox").browser_specific_settings).toEqual({
      gecko: {
        id: "claviger@claviger.app",
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

describe("side panel entrypoint", () => {
  it("tells Firefox not to open the sidebar at install", () => {
    const html = readFileSync(
      new URL("../entrypoints/sidepanel/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toContain('<meta name="manifest.open_at_install" content="false" />');
  });

  it("does not declare sidePanel by hand (WXT adds it for the Chrome entrypoint)", () => {
    expect(manifestFor("chrome").permissions).not.toContain("sidePanel");
    expect(manifestFor("firefox").permissions).not.toContain("sidePanel");
  });

  type Built = {
    permissions?: string[];
    side_panel?: { default_path?: string };
    sidebar_action?: { default_panel?: string; open_at_install?: boolean };
  };
  const built = (dir: string) => new URL(`../.output/${dir}/manifest.json`, import.meta.url);

  describe.skipIf(!existsSync(built("chrome-mv3")))("built Chrome manifest", () => {
    const manifest = () => JSON.parse(readFileSync(built("chrome-mv3"), "utf8")) as Built;
    it("has the side panel page and permission, and no sidebar_action", () => {
      expect(manifest().side_panel?.default_path).toBe("sidepanel.html");
      expect(manifest().permissions).toContain("sidePanel");
      expect(manifest().sidebar_action).toBeUndefined();
    });
  });

  describe.skipIf(!existsSync(built("firefox-mv3")))("built Firefox manifest", () => {
    const manifest = () => JSON.parse(readFileSync(built("firefox-mv3"), "utf8")) as Built;
    it("has a sidebar that does not open at install, and no sidePanel permission", () => {
      expect(manifest().sidebar_action?.default_panel).toBe("sidepanel.html");
      expect(manifest().sidebar_action?.open_at_install).toBe(false);
      expect(manifest().permissions).not.toContain("sidePanel");
      expect(manifest().side_panel).toBeUndefined();
    });
  });
});
