// Sums the JS the popup page loads: the entry script plus every modulepreload chunk.
// Budget: 300 kB. Usage: node scripts/popup-size.mjs [build dir]
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUDGET = 300_000;
const dir = resolve(process.argv[2] ?? join(import.meta.dirname, "../.output/chrome-mv3"));
const html = readFileSync(join(dir, "popup.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+\.js)"/g)].map((m) => m[1]);
if (refs.length === 0) {
  console.error("popup.html references no JS files; the build layout changed.");
  process.exit(2);
}
let total = 0;
for (const ref of new Set(refs)) {
  const size = statSync(join(dir, ref)).size;
  total += size;
  console.log(`${String(size).padStart(8)}  ${ref}`);
}
console.log(`${String(total).padStart(8)}  total (budget ${BUDGET})`);
if (total > BUDGET) {
  console.error(`Popup JS is ${total - BUDGET} bytes over budget.`);
  process.exit(1);
}
