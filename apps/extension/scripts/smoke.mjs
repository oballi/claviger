/* global chrome */
// Loads the built Chrome extension in headless Chromium and walks the first-run flow.
// Needs the SMOKE=1 build (`pnpm --filter @claviger/extension build:smoke`): it adds <all_urls> so fill and capture can be
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
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "claviger-smoke-")), {
  executablePath: process.env.CHROMIUM_PATH || undefined,
  headless: true,
  locale: "tr-TR",
  args: [
    `--disable-extensions-except=${ext}`,
    `--load-extension=${ext}`,
    "--headless=new",
    "--lang=tr-TR",
  ],
});
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
      (req) => chrome.runtime.sendMessage({ channel: "claviger/rpc", request: req }),
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

  // Plan 8: moveAccount RPC, popup menu/theme/sort mode, manage layout at 1280 and 1024.
  {
    const g1 = await must({ type: "createGroup", name: "Kişisel hesaplar" });
    const g2 = await must({ type: "createGroup", name: "Work2" });
    const subject = (await must({ type: "listAccounts" })).accounts.find(
      (a) => a.issuer === "Fill",
    );
    await must({ type: "moveAccount", id: subject.id, groupId: g2.id, beforeId: null });
    const moved = (await must({ type: "listAccounts" })).accounts.find((a) => a.id === subject.id);
    if (moved.groupId !== g2.id) throw new Error("moveAccount did not change the group");
    const bad = await rpc({ type: "moveAccount", id: subject.id, groupId: "nope", beforeId: null });
    if (bad?.ok || !JSON.stringify(bad).includes("group-not-found"))
      throw new Error(`moveAccount to a missing group gave ${JSON.stringify(bad)}`);

    await popup.goto(`chrome-extension://${id}/popup.html`);
    await popup
      .getByRole("button", { name: /için işlemler/ })
      .first()
      .click();
    const items = await popup.getByRole("menuitem").allTextContents();
    const joined = items.join("|");
    for (const want of ["Sabitle", "Düzenle", "Gruba taşı", "Sil"])
      if (!joined.includes(want)) throw new Error(`row menu lacks ${want}: ${joined}`);
    if (/Yukarı taşı|Aşağı taşı/.test(joined)) throw new Error("row menu still has move up/down");
    await popup.keyboard.press("Escape");

    const themeBtn = popup.getByRole("button", { name: /temaya geç/ });
    const themeBefore = await popup.evaluate(() => document.documentElement.dataset.theme);
    await themeBtn.click();
    await popup.waitForFunction((b) => document.documentElement.dataset.theme !== b, themeBefore);
    const themeAfter = await popup.evaluate(() => document.documentElement.dataset.theme);
    const stored = (await must({ type: "getState" })).theme;
    if (stored !== themeAfter) throw new Error(`theme ${themeAfter} not stored (${stored})`);

    const sortBtn = popup.getByRole("button", { name: "Sırala", exact: true });
    await sortBtn.click();
    if ((await sortBtn.getAttribute("aria-pressed")) !== "true")
      throw new Error("sort mode did not engage");
    if (await popup.getByRole("button", { name: /kodu kopyala/i }).count())
      throw new Error("codes still visible in sort mode");
    await popup.keyboard.press("Escape");
    if ((await sortBtn.getAttribute("aria-pressed")) !== "false")
      throw new Error("Escape did not leave sort mode");
    if (!(await sortBtn.evaluate((el) => el === document.activeElement)))
      throw new Error("focus did not return to the sort button");

    const layout = async (width) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`chrome-extension://${id}/manage.html#/accounts`);
      await page.reload();
      await page.getByRole("table").waitFor();
      return page.evaluate(() => {
        const wrap = document.querySelector("table").parentElement;
        const w = wrap.getBoundingClientRect();
        const edit = [...document.querySelectorAll("table button")].find((b) =>
          /^Düzenle$/.test(b.textContent.trim()),
        );
        const e = edit?.getBoundingClientRect();
        const nameSpan = [
          ...document.querySelectorAll("section[aria-label] li button span.truncate"),
        ].find((x) => x.textContent === "Kişisel hesaplar");
        const row = nameSpan?.closest("li");
        const clipped = row
          ? [...row.querySelectorAll("button")].some((b) => {
              const r = b.getBoundingClientRect();
              const rr = row.getBoundingClientRect();
              return r.width === 0 || r.right > rr.right + 0.5 || r.left < rr.left - 0.5;
            })
          : true;
        return {
          fits: wrap.scrollWidth <= wrap.clientWidth,
          editInside: Boolean(e && e.right <= w.right + 0.5),
          pageScroll: document.documentElement.scrollWidth > window.innerWidth,
          nameWidth: nameSpan ? nameSpan.getBoundingClientRect().width : -1,
          nameClientWidth: nameSpan ? nameSpan.clientWidth : -1,
          clipped,
        };
      });
    };
    for (const width of [1280, 1024]) {
      const r = await layout(width);
      console.log(`layout ${width}: ${JSON.stringify(r)}`);
      if (!r.fits || !r.editInside || r.pageScroll)
        throw new Error(`manage layout overflows at ${width}: ${JSON.stringify(r)}`);
      if (width === 1280 && (r.nameWidth < 56 || r.clipped))
        throw new Error(`group row too tight at 1280: ${JSON.stringify(r)}`);
    }
    await must({ type: "deleteGroup", id: g1.id });
    await must({ type: "deleteGroup", id: g2.id });
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
