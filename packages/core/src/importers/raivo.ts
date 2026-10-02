import { z } from "zod";
import { CoreError } from "../errors";
import { assertEntryCount, DETECT_SAMPLE } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

// Raivo writes every value as a string, numbers included.
const entrySchema = z.object({
  kind: z.string(),
  secret: z.string(),
  account: z.string(),
  issuer: z.string().optional(),
  algorithm: z.string().optional(),
  digits: z.string().optional(),
  timer: z.string().optional(),
  counter: z.string().optional(),
});

export const isRaivo = (json: unknown): boolean =>
  Array.isArray(json) && json.slice(0, DETECT_SAMPLE).some((e) => entrySchema.safeParse(e).success);

// NaN is rejected later by normalizeAccountInput as invalid params.
const num = (s: string | undefined): number | undefined =>
  s === undefined || s.trim() === "" ? undefined : Number(s);

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
    collect(result, position, issuer ? `${issuer}: ${e.account}` : e.account, {
      type: e.kind.toLowerCase(),
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
