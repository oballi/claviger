import { describe, expect, it } from "vitest";
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

describe("manifest", () => {
  it.each(["chrome", "firefox"])("declares the spec's permissions and CSP for %s", (browser) => {
    const manifest = manifestFor(browser);
    expect(manifest.permissions).toEqual(["storage", "alarms", "idle", "activeTab", "scripting"]);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    });
    expect(manifest.version).toBe("0.0.1");
  });

  it("pins the Firefox add-on id and minimum version", () => {
    expect(manifestFor("firefox").browser_specific_settings).toEqual({
      gecko: {
        id: "otp-vault@otp-vault.dev",
        strict_min_version: "128.0",
        data_collection_permissions: { required: ["none"] },
      },
    });
    expect(manifestFor("firefox").minimum_chrome_version).toBeUndefined();
  });

  it("pins the minimum Chrome version", () => {
    expect(manifestFor("chrome").minimum_chrome_version).toBe("116");
    expect(manifestFor("chrome").browser_specific_settings).toBeUndefined();
  });
});
