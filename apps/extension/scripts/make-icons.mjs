// Renders assets/icon*.svg into public/icon/<size>.png with Chromium (playwright-core).
// Usage: node scripts/make-icons.mjs   (CHROMIUM_PATH overrides the browser binary)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { chromium } from "playwright-core";

const root = join(import.meta.dirname, "..");
const executablePath =
  process.env.CHROMIUM_PATH ??
  join(homedir(), ".cache/ms-playwright/chromium-1234/chrome-linux64/chrome");
const svg = (name) => readFileSync(join(root, "assets", name), "utf8");
// 128 keeps ~16px transparent padding per Chrome Web Store guidance.
const jobs = [
  { size: 16, art: svg("icon-16.svg"), box: 16 },
  { size: 32, art: svg("icon.svg"), box: 32 },
  { size: 48, art: svg("icon.svg"), box: 48 },
  { size: 128, art: svg("icon.svg"), box: 96 },
];

mkdirSync(join(root, "public/icon"), { recursive: true });
const browser = await chromium.launch({ executablePath });
try {
  for (const { size, art, box } of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const inner = art.replace(/ width="\d+" height="\d+"/, ` width="${box}" height="${box}"`);
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}body{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}svg{display:block}</style>${inner}`,
    );
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    writeFileSync(join(root, "public/icon", `${size}.png`), png);
    await page.close();
  }
} finally {
  await browser.close();
}
