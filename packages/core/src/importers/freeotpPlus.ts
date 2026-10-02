import { z } from "zod";
import { base32Encode } from "../encoding/base32";
import { CoreError } from "../errors";
import { assertEntryCount } from "./limits";
import { collect, emptyResult, type ImportResult } from "./types";

const tokenSchema = z.object({
  type: z.string(),
  secret: z.array(z.number().int().min(-128).max(255)).min(1).max(1024),
  algo: z.string().optional(),
  digits: z.number().optional(),
  period: z.number().optional(),
  counter: z.number().optional(),
  issuerExt: z.string().optional(),
  issuerInt: z.string().optional(),
  label: z.string().optional(),
});
const fileSchema = z.object({ tokens: z.array(z.unknown()) });

export const isFreeotpPlus = (json: unknown): boolean => {
  const file = fileSchema.safeParse(json);
  return file.success && file.data.tokens.some((t) => tokenSchema.safeParse(t).success);
};

export function parseFreeotpPlus(json: unknown): ImportResult {
  const file = fileSchema.safeParse(json);
  if (!file.success) throw new CoreError("unsupported-format", "Not a FreeOTP+ export");
  const { tokens } = file.data;
  assertEntryCount(tokens.length);
  const result = emptyResult();
  tokens.forEach((raw, position) => {
    const t = tokenSchema.safeParse(raw);
    if (!t.success) {
      result.issues.push({ position, name: "", reason: "malformed-entry" });
      return;
    }
    const issuer = t.data.issuerExt || t.data.issuerInt || "";
    // FreeOTP stores Java signed bytes; mask to 0..255.
    const secret = base32Encode(Uint8Array.from(t.data.secret, (b) => b & 0xff));
    const kind = t.data.type.toLowerCase();
    collect(result, position, issuer ? `${issuer}: ${t.data.label ?? ""}` : (t.data.label ?? ""), {
      type: kind === "totp" && t.data.issuerExt === "Steam" ? "steam" : kind,
      secret,
      issuer,
      label: t.data.label,
      algorithm: t.data.algo,
      digits: t.data.digits,
      period: t.data.period,
      counter: t.data.counter,
    });
  });
  return result;
}
