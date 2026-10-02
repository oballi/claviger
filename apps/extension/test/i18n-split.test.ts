import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { en, tr } from "@otp-vault/ui";
import { manageMessages } from "@otp-vault/ui/manage";

const UI_SRC = resolve(import.meta.dirname, "../../../packages/ui/src");

function resolveImport(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

function closure(entries: string[]): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(?:from|import)\s*(?:\(\s*)?["']([^"']+)["']/g)) {
      const next = resolveImport(file, m[1]!);
      if (next) walk(next);
    }
  };
  entries.forEach((e) => walk(join(UI_SRC, e)));
  return [...seen].filter((f) => !f.includes("/i18n/"));
}

const popupKeys = Object.keys(tr);
const manageKeys = Object.keys(manageMessages.tr);

describe("i18n dictionary split", () => {
  it("keeps TR/EN parity and no key in both dictionaries", () => {
    expect(Object.keys(en).sort()).toEqual([...popupKeys].sort());
    expect(Object.keys(manageMessages.en).sort()).toEqual([...manageKeys].sort());
    expect(popupKeys.filter((k) => manageKeys.includes(k))).toEqual([]);
  });

  it("popup-reachable sources only reference keys the popup dictionary holds", () => {
    const text = closure(["index.ts", "popup/index.ts"])
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    const missing = manageKeys.filter((k) => text.includes(`"${k}"`));
    expect(missing).toEqual([]);
    const prefixes = [...text.matchAll(/`([a-zA-Z.]+)\$\{/g)].map((m) => m[1]!);
    const dynamic = manageKeys.filter((k) => prefixes.some((p) => k.startsWith(p)));
    expect(dynamic).toEqual([]);
  });
});
