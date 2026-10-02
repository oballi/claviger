import { z } from "zod";
import { CoreError } from "../errors";
import { assertEntryCount, DETECT_SAMPLE } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

// Raivo writes numbers as strings; some exporters emit real numbers.
const numeric = z.union([z.string(), z.number()]).optional();
const entrySchema = z.object({
  kind: z.string(),
  secret: z.string(),
  account: z.string(),
  issuer: z.string().optional(),
  algorithm: z.string().optional(),
  digits: numeric,
  timer: numeric,
  counter: numeric,
});

export const isRaivo = (json: unknown): boolean =>
  Array.isArray(json) && json.slice(0, DETECT_SAMPLE).some((e) => entrySchema.safeParse(e).success);

// Strict digits only (Number() accepts " 6" and "0x10"); NaN is rejected later by
// normalizeAccountInput as invalid params.
const num = (v: string | number | undefined): number | undefined => {
  if (v === undefined || v === "") return undefined;
  if (typeof v === "number") return v;
  return /^\d+$/.test(v) ? Number(v) : Number.NaN;
};

// Raivo has no Steam or mOTP type; anything else is reported, not guessed.
const KINDS = new Set(["totp", "hotp"]);

export function parseRaivo(json: unknown): ImportResult {
  const list = z.array(z.unknown()).safeParse(json);
  if (!list.success) throw new CoreError("unsupported-format", "Not a Raivo export");
  assertEntryCount(list.data.length);
  const result = emptyResult();
  list.data.forEach((raw, position) => {
    const entry = entrySchema.safeParse(raw);
    if (!entry.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const e = entry.data;
    const issuer = e.issuer ?? "";
    const name = issuer ? `${issuer}: ${e.account}` : e.account;
    const kind = e.kind.toLowerCase();
    if (!KINDS.has(kind)) {
      result.issues.push({ position, name, reason: "unsupported-type" });
      return;
    }
    collect(result, position, name, {
      type: kind,
      secret: e.secret,
      issuer,
      label: e.account,
      algorithm: e.algorithm,
      digits: num(e.digits),
      period: num(e.timer),
      counter: num(e.counter),
    });
  });
  return result;
}
