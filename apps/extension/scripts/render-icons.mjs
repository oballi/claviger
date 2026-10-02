// Renders the toolbar/store icons from icon-src/*.svg with the bundled Chromium.
// Usage: CHROMIUM_PATH=... node scripts/render-icons.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Sizes at or below 32 px use the heavier small master so the ring stays legible.
const targets = [
  [16, "icon-small.svg"],
  [32, "icon-small.svg"],
  [48, "icon.svg"],
  [128, "icon.svg"],
];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage();
for (const [size, file] of targets) {
  const svg = readFileSync(join(root, "icon-src", file), "utf8").replace(
    "<svg ",
    `<svg width="${size}" height="${size}" `,
  );
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({
    path: join(root, "public", "icon", `${size}.png`),
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
}
await browser.close();
