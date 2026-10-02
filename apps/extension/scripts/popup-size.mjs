// Sums the JS the popup page loads: the entry script plus every modulepreload chunk.
// Budget: 315 kB. Usage: node scripts/popup-size.mjs [build dir]
// Also asserts the zod jitless config is present in every built file that bundles zod.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const BUDGET = 315_000;
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

// Lazy chunks load on demand and are not in popup.html; report them with their own cap.
const LAZY_BUDGET = 30_000;
for (const f of readdirSync(join(dir, "chunks")).filter((f) =>
  /^(EditAccount|TrashList)-.*\.js$/.test(f),
)) {
  const size = statSync(join(dir, "chunks", f)).size;
  console.log(`${String(size).padStart(8)}  chunks/${f} (lazy, budget ${LAZY_BUDGET})`);
  if (size > LAZY_BUDGET) {
    console.error(`Lazy chunk ${f} is ${size - LAZY_BUDGET} bytes over budget.`);
    process.exit(1);
  }
}

// zod's JIT probes eval and violates the extension CSP; a sideEffects change must not drop the config.
const files = [
  join(dir, "background.js"),
  ...readdirSync(join(dir, "chunks"))
    .filter((f) => f.endsWith(".js"))
    .map((f) => join(dir, "chunks", f)),
];
let zodFiles = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!text.includes("ZodError")) continue;
  zodFiles++;
  if (!text.includes("jitless")) {
    console.error(
      `${file} bundles zod but lacks the jitless config; check sideEffects in packages/ui.`,
    );
    process.exit(1);
  }
}
if (zodFiles === 0) {
  console.error("No built file contains zod; the jitless check found nothing to verify.");
  process.exit(1);
}
