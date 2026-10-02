import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./release.mjs", import.meta.url).pathname;

const git = (dir, ...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
const write = (dir, file, text) => {
  mkdirSync(join(dir, file, ".."), { recursive: true });
  writeFileSync(join(dir, file), text);
};
const commit = (dir, msg) => {
  git(dir, "commit", "--allow-empty", "-m", msg);
};

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "release-test-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.name", "Test");
  git(dir, "config", "user.email", "test@example.com");
  git(dir, "config", "commit.gpgsign", "false");
  git(dir, "config", "tag.gpgsign", "false");
  const pkg = JSON.stringify({ name: "x", version: "0.0.1" }, null, 2) + "\n";
  for (const f of [
    "package.json",
    "apps/extension/package.json",
    "packages/core/package.json",
    "packages/ui/package.json",
  ]) {
    write(dir, f, pkg);
  }
  write(dir, "packages/core/src/index.ts", 'export const CORE_VERSION = "0.0.1";\n');
  git(dir, "add", "-A");
  commit(dir, "feat: a");
  commit(dir, "fix: b");
  commit(dir, "chore: c");
  return dir;
}

const run = (dir, ...a) => spawnSync("node", [script, ...a, "--cwd", dir], { encoding: "utf8" });

test("bumps versions, writes changelog, commits and tags", () => {
  const dir = makeRepo();
  const res = run(dir, "0.1.0");
  assert.equal(res.status, 0, res.stderr);
  for (const f of [
    "package.json",
    "apps/extension/package.json",
    "packages/core/package.json",
    "packages/ui/package.json",
  ]) {
    assert.equal(JSON.parse(readFileSync(join(dir, f), "utf8")).version, "0.1.0");
  }
  assert.match(
    readFileSync(join(dir, "packages/core/src/index.ts"), "utf8"),
    /CORE_VERSION = "0\.1\.0"/,
  );
  const log = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
  assert.match(log, /### Features\n\n- a\n/);
  assert.match(log, /### Fixes\n\n- b\n/);
  assert.doesNotMatch(log, /- c/);
  assert.match(git(dir, "tag"), /v0\.1\.0/);
  assert.equal(git(dir, "log", "-1", "--format=%s"), "chore(release): 0.1.0");
});

test("dry run changes nothing", () => {
  const dir = makeRepo();
  const res = run(dir, "0.1.0", "--dry-run");
  assert.equal(res.status, 0, res.stderr);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(dir, "tag"), "");
});

test("refuses a dirty tree", () => {
  const dir = makeRepo();
  write(dir, "dirty.txt", "x");
  assert.notEqual(run(dir, "0.1.0").status, 0);
});

test("refuses a version that is not greater", () => {
  const dir = makeRepo();
  assert.notEqual(run(dir, "0.0.1").status, 0);
  assert.notEqual(run(dir, "0.0.0").status, 0);
});

test("refuses an existing tag", () => {
  const dir = makeRepo();
  git(dir, "tag", "v0.1.0");
  assert.notEqual(run(dir, "0.1.0").status, 0);
});

test("refuses a branch other than master or main", () => {
  const dir = makeRepo();
  git(dir, "checkout", "-q", "-b", "feat/x");
  const res = run(dir, "0.1.0");
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /master or main/);
  assert.equal(git(dir, "tag"), "");
});

test("fails without touching files when CORE_VERSION is missing", () => {
  const dir = makeRepo();
  write(dir, "packages/core/src/index.ts", "export {};\n");
  git(dir, "commit", "-qam", "chore: drop constant");
  const res = run(dir, "0.1.0");
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /CORE_VERSION/);
  assert.equal(git(dir, "status", "--porcelain"), "");
  assert.equal(git(dir, "tag"), "");
});

test("fails when --cwd has no value", () => {
  const res = spawnSync("node", [script, "0.1.0", "--cwd"], { encoding: "utf8" });
  assert.notEqual(res.status, 0);
  assert.match(res.stderr, /--cwd needs a directory/);
});
