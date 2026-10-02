/* global chrome */
// Loads the built Chrome extension in headless Chromium and walks the first-run flow.
// Needs the SMOKE=1 build (`pnpm --filter @otp-vault/extension build:smoke`): it adds <all_urls> so fill and capture can be
// driven without a real toolbar click. The real activeTab grants are on the manual checklist.
// EXTENSION_DIR overrides the build folder. Needs a Chromium binary: set CHROMIUM_PATH, or run `pnpm exec playwright-core install chromium` once.
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import qrcode from "qrcode-generator";

const ext = process.env.EXTENSION_DIR
  ? resolve(process.env.EXTENSION_DIR)
  : resolve(import.meta.dirname, "../.output-smoke/chrome-mv3");
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
// Chromium reports CSP violations (e.g. eval) as console errors too; this names them explicitly.
await ctx.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) =>
    console.error(`securitypolicyviolation: ${e.violatedDirective} ${e.blockedURI}`),
  );
});
try {
  const worker =
    ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker", { timeout: 15_000 }));
  const id = new URL(worker.url()).host;
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`manage: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`manage console: ${m.text()}`));
  // The popup of a fresh install must lead to the setup wizard in a new tab.
  const firstPopup = await ctx.newPage();
  firstPopup.on("pageerror", (e) => errors.push(`popup: ${e.message}`));
  firstPopup.on(
    "console",
    (m) => m.type() === "error" && errors.push(`popup console: ${m.text()}`),
  );
  await firstPopup.goto(`chrome-extension://${id}/popup.html`);
  await firstPopup.getByRole("button", { name: "Kurulumu başlat" }).click();
  // onInstalled may already have opened a setup tab; accept that one or a new one.
  const isSetup = (pg) => pg !== page && /manage\.html#\/setup/.test(pg.url());
  const deadline = Date.now() + 10_000;
  let setupTab;
  while (!(setupTab = ctx.pages().find(isSetup))) {
    if (Date.now() > deadline) throw new Error("setup tab did not open");
    await new Promise((r) => setTimeout(r, 100));
  }
  await setupTab.close();

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
  popup.on("console", (m) => m.type() === "error" && errors.push(`popup console: ${m.text()}`));
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await popup.getByText("Henüz hesap yok.").waitFor();

  // The popup must reuse an open manage tab (even on a hash route) instead of opening another.
  await page.goto(`chrome-extension://${id}/manage.html#/security`);
  const manageTabs = () => ctx.pages().filter((p) => p.url().includes("/manage.html"));
  const manageBefore = manageTabs().length;
  const reuse = await ctx.newPage();
  await reuse.goto(`chrome-extension://${id}/popup.html`);
  await reuse.getByRole("button", { name: "Hesap ekle" }).click();
  await reuse.getByRole("button", { name: /İçe aktar/ }).click();
  await page.waitForURL(/manage\.html#\/backup/, { timeout: 10_000 });
  if (manageTabs().length !== manageBefore) throw new Error("popup opened a second manage tab");

  const fixture = (name) => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
  const QR_URI = "otpauth://totp/Fixture:qr@example.test?secret=GEZDGNBVGY3TQOJQ&issuer=Fixture";
  const qr = qrcode(0, "M");
  qr.addData(QR_URI);
  qr.make();
  const qrHtml = fixture("qr-page.html").replace("__QR__", qr.createDataURL(8, 16));
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    const body =
      path === "/fill-page.html"
        ? fixture("fill-page.html")
        : path === "/qr-page.html"
          ? qrHtml
          : "<p>x</p>";
    res.setHeader("content-type", "text/html").end(body);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const rpc = (request) =>
    popup.evaluate(
      (req) => chrome.runtime.sendMessage({ channel: "otp-vault/rpc", request: req }),
      request,
    );
  const must = async (request) => {
    const r = await rpc(request);
    if (!r?.ok) throw new Error(`${request.type} failed: ${JSON.stringify(r)}`);
    return r.data ?? r.value ?? r;
  };
  const activeTabId = () =>
    popup.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab?.id;
    });

  // Fill: the SMOKE build holds <all_urls>, so the real activeTab grant is replaced by a queried tab id.
  const FILL_URI = "otpauth://totp/Fill:me?secret=JBSWY3DPEHPK3PXP&issuer=Fill";
  await must({ type: "addAccountUri", uri: FILL_URI, sourceUrl: `${origin}/` });
  const fillId = (await must({ type: "listAccounts" })).accounts.find(
    (a) => a.issuer === "Fill",
  ).id;
  const codeOf = async () =>
    (await must({ type: "listAccounts" })).accounts.find((a) => a.id === fillId).code;
  const filled = async (mode) => {
    const fp = await ctx.newPage();
    fp.on("pageerror", (e) => errors.push(`fixture: ${e.message}`));
    await fp.goto(`${origin}/fill-page.html?mode=${mode}`);
    await fp.bringToFront();
    const tabId = await activeTabId();
    const before = await codeOf();
    const out = await must({ type: "fillCode", id: fillId, tabId });
    const after = await codeOf();
    if (out.result !== "filled") throw new Error(`fill (${mode}) gave ${JSON.stringify(out)}`);
    return { fp, before, after };
  };
  {
    const { fp, before, after } = await filled("split");
    const value = (await fp.locator(".box").evaluateAll((els) => els.map((e) => e.value))).join("");
    if (!/^\d{6}$/.test(value) || (value !== before && value !== after))
      throw new Error("six-box fill wrote an unexpected value");
    await fp.close();
  }
  {
    const { fp, before, after } = await filled("single");
    const value = await fp.locator("#otp").inputValue();
    if (!/^\d{6}$/.test(value) || (value !== before && value !== after))
      throw new Error("one-time-code fill wrote an unexpected value");
    if ((await fp.locator("#pw").inputValue()) !== "") throw new Error("password field was filled");
    await fp.close();
  }

  // Scan: capture the QR page under the SMOKE permission, then drive scan.html#<id> as a page.
  {
    const qp = await ctx.newPage();
    await qp.goto(`${origin}/qr-page.html`);
    await qp.bringToFront();
    const dataUrl = await popup.evaluate(() => chrome.tabs.captureVisibleTab({ format: "png" }));
    const { id: captureId } = await must({
      type: "storeCapture",
      dataUrl,
      tabUrl: `${origin}/qr-page.html`,
    });
    await qp.close();
    const scan = await ctx.newPage();
    scan.on("pageerror", (e) => errors.push(`scan: ${e.message}`));
    scan.on("console", (m) => m.type() === "error" && errors.push(`scan console: ${m.text()}`));
    await scan.goto(`chrome-extension://${id}/scan.html#${captureId}`);
    await scan.getByRole("button", { name: "Ekle" }).click({ timeout: 30_000 });
    await scan.getByText(/Eklendi/).waitFor();
    const found = (await must({ type: "listAccounts" })).accounts.find(
      (a) => a.issuer === "Fixture",
    );
    if (!found) throw new Error("scanned account was not added");
    if (!found.domains.includes("127.0.0.1")) throw new Error("scanned account not linked to site");
    await scan.close();
  }

  // Groups: RPC round trip, then the popup renders sections and the row menu.
  {
    const work = await must({ type: "createGroup", name: "Work" });
    const listed = await must({ type: "listAccounts" });
    const target = listed.accounts.find((a) => a.issuer === "Fill");
    await must({ type: "setAccountGroup", id: target.id, groupId: work.id });
    const grouped = await must({ type: "listAccounts" });
    if (
      grouped.groups.length !== 1 ||
      grouped.accounts.find((a) => a.id === target.id).groupId !== work.id
    )
      throw new Error("group assignment did not round-trip");
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole("button", { name: /Work/, expanded: true }).waitFor({ timeout: 10_000 });
    const menu = popup.getByRole("button", { name: /için işlemler/ }).first();
    if ((await menu.getAttribute("aria-haspopup")) !== "menu")
      throw new Error("row menu is not a menu button");
    await must({ type: "deleteGroup", id: work.id });
    const after = await must({ type: "listAccounts" });
    if (
      after.groups.length !== 0 ||
      after.accounts.find((a) => a.id === target.id).groupId !== null
    )
      throw new Error("deleting a group did not ungroup its accounts");
  }

  // Recently deleted: delete -> bin -> restore round trip; the popup shows the entry link.
  {
    const bin = await must({
      type: "addAccountManual",
      draft: { secret: "JBSWY3DPEHPK3PXQ", issuer: "BinCheck" },
    });
    await must({ type: "deleteAccount", id: bin.id });
    const items = await must({ type: "listTrash" });
    const mine = items.find((i) => i.id === bin.id);
    if (!mine || mine.daysLeft !== 30) throw new Error("deleted account is not in the bin");
    if (JSON.stringify(items).includes("JBSWY3DPEHPK3PXQ"))
      throw new Error("bin view leaks the secret");
    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup.getByRole("button", { name: /Son silinenler · \d+/ }).waitFor({ timeout: 10_000 });
    const restored = await must({ type: "restoreTrash", id: bin.id });
    const listed = await must({ type: "listAccounts" });
    if (!listed.accounts.some((a) => a.id === restored.id && a.issuer === "BinCheck"))
      throw new Error("restore did not bring the account back");
    await must({ type: "deleteAccount", id: restored.id });
    await must({ type: "purgeTrash", id: restored.id });
    if ((await must({ type: "listTrash" })).some((i) => i.id === restored.id))
      throw new Error("removing from the list left an entry behind");
  }

  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin });
  const reader = await ctx.newPage();
  await reader.goto(origin);
  const set = await rpc({ type: "setClipboardClear", seconds: 30 });
  if (!set?.ok) throw new Error(`setClipboardClear failed: ${JSON.stringify(set)}`);
  await popup.bringToFront();
  await popup.evaluate(() => navigator.clipboard.writeText("123456"));
  const copied = await rpc({ type: "clipboardCopied" });
  if (!copied?.ok) throw new Error(`clipboardCopied failed: ${JSON.stringify(copied)}`);
  await reader.bringToFront();
  const before = await reader.evaluate(() => navigator.clipboard.readText());
  if (before !== "123456") throw new Error("clipboard read-back is not working");
  await popup.waitForTimeout(31_000);
  await reader.bringToFront();
  const after = await reader.evaluate(() => navigator.clipboard.readText());
  server.close();
  if (after.trim() !== "") throw new Error(`clipboard not cleared, got length ${after.length}`);
} finally {
  await ctx.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("smoke: ok");
