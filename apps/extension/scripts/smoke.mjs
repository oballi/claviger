// Loads the built Chrome extension in headless Chromium and walks the first-run flow.
// EXTENSION_DIR overrides the build folder. Needs a Chromium binary: set CHROMIUM_PATH, or run `pnpm exec playwright-core install chromium` once.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";

const ext = process.env.EXTENSION_DIR
  ? resolve(process.env.EXTENSION_DIR)
  : resolve(import.meta.dirname, "../.output/chrome-mv3");
const ctx = await chromium.launchPersistentContext(
  mkdtempSync(join(tmpdir(), "otp-vault-smoke-")),
  {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    headless: true,
    locale: "tr-TR",
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      "--headless=new",
      "--lang=tr-TR",
    ],
  },
);
const errors = [];
try {
  const worker =
    ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
  const id = new URL(worker.url()).host;
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`manage: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`manage console: ${m.text()}`));
  await page.goto(`chrome-extension://${id}/manage.html#/setup`);
  await page.getByLabel("Ana parola", { exact: true }).fill("kirmizi bisiklet ruzgar");
  await page.getByLabel("Parolayı tekrar gir").fill("kirmizi bisiklet ruzgar");
  await page.getByRole("button", { name: /Devam/ }).click();
  await page.getByRole("button", { name: "Kod oluştur" }).click();
  await page.getByRole("checkbox").first().check();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /Devam/ }).click();
  await page.getByRole("heading", { name: "İlk hesabını ekle." }).waitFor();

  const popup = await ctx.newPage();
  popup.on("pageerror", (e) => errors.push(`popup: ${e.message}`));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByText("Henüz hesap yok.").waitFor();
} finally {
  await ctx.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("smoke: ok");
