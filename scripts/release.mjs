#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const cwdIndex = args.indexOf("--cwd");
const dryRun = args.includes("--dry-run");
const version = args.find((a, i) => /^\d+\.\d+\.\d+$/.test(a) && args[i - 1] !== "--cwd");
if (cwdIndex >= 0 && (!args[cwdIndex + 1] || args[cwdIndex + 1].startsWith("--"))) {
  console.error("release: --cwd needs a directory");
  process.exit(1);
}
const root = cwdIndex >= 0 ? args[cwdIndex + 1] : fileURLToPath(new URL("..", import.meta.url));

const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
const fail = (msg) => {
  console.error(`release: ${msg}`);
  process.exit(1);
};
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

if (!version) fail("usage: release.mjs <x.y.z> [--dry-run]");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (branch !== "master" && branch !== "main")
  fail(`releases are cut from master or main, not ${branch}`);
if (git("status", "--porcelain")) fail("working tree is not clean");
const PKGS = [
  "package.json",
  "apps/extension/package.json",
  "packages/core/package.json",
  "packages/ui/package.json",
];
const current = JSON.parse(readFileSync(join(root, PKGS[0]), "utf8")).version;
if (cmp(version, current) <= 0) fail(`${version} is not greater than ${current}`);
if (git("tag", "--list", `v${version}`)) fail(`tag v${version} already exists`);

const indexPath = join(root, "packages/core/src/index.ts");
const indexSource = readFileSync(indexPath, "utf8");
const bumped = indexSource.replace(/CORE_VERSION = "[^"]+"/, `CORE_VERSION = "${version}"`);
// Checked before any write so a failure leaves the tree untouched.
if (bumped === indexSource) fail("CORE_VERSION was not found in packages/core/src/index.ts");

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*");
} catch (e) {
  // Only "no tags yet" means a first release; anything else is a real failure.
  if (!/No names found|No tags can describe/i.test(String(e.stderr))) throw e;
}
const subjects = git("log", "--format=%s", lastTag ? `${lastTag}..HEAD` : "HEAD")
  .split("\n")
  .filter(Boolean);
const groups = { Features: "feat", Fixes: "fix", Performance: "perf" };
const date = new Date().toISOString().slice(0, 10);
let section = `## ${version} — ${date}\n`;
for (const [title, type] of Object.entries(groups)) {
  const items = subjects
    .map((s) => s.match(new RegExp(`^${type}(\\([^)]*\\))?!?: (.+)$`)))
    .filter(Boolean)
    .map((m) => `- ${m[2]}`);
  if (items.length) section += `\n### ${title}\n\n${items.join("\n")}\n`;
}

if (dryRun) {
  console.log(section);
  process.exit(0);
}
for (const file of PKGS) {
  const path = join(root, file);
  const pkg = JSON.parse(readFileSync(path, "utf8"));
  pkg.version = version;
  writeFileSync(path, `${JSON.stringify(pkg, null, 2)}\n`);
}
writeFileSync(indexPath, bumped);
const changelogPath = join(root, "CHANGELOG.md");
const previous = existsSync(changelogPath)
  ? readFileSync(changelogPath, "utf8").replace(/^# Changelog\n+/, "")
  : "";
writeFileSync(changelogPath, `# Changelog\n\n${section}\n${previous}`);
git("add", ...PKGS, "packages/core/src/index.ts", "CHANGELOG.md");
git("commit", "-m", `chore(release): ${version}`);
git("tag", "-a", `v${version}`, "-m", `v${version}`);
console.log(`release: v${version} committed and tagged locally (not pushed)`);
