import type { AccountDraft } from "../account/account";
import { base32Encode } from "../encoding/base32";
import { fromBase64 } from "../encoding/base64";
import { utf8Decode } from "../encoding/bytes";
import { readFields } from "../encoding/protobuf";
import { CoreError } from "../errors";
import { collect, emptyResult, type ImportResult } from "./types";

// google/protobuf MigrationPayload.OtpParameters enum values
const ALGORITHMS: Record<number, string> = {
  0: "SHA1",
  1: "SHA1",
  2: "SHA256",
  3: "SHA512",
  4: "MD5",
};
const DIGITS: Record<number, number> = { 0: 6, 1: 6, 2: 8 };
const TYPES: Record<number, string> = { 0: "totp", 1: "hotp", 2: "totp" };

export interface MigrationBatch {
  size: number;
  index: number;
  id: number;
}

function parseOtpParameters(bytes: Uint8Array): { name: string; draft: AccountDraft } {
  let secret: Uint8Array = new Uint8Array();
  let name = "";
  let issuer = "";
  let algorithm = 0;
  let digits = 0;
  let type = 0;
  let counter = 0n;
  for (const f of readFields(bytes)) {
    if (f.wire === 2) {
      if (f.field === 1) secret = f.value;
      else if (f.field === 2) name = utf8Decode(f.value);
      else if (f.field === 3) issuer = utf8Decode(f.value);
    } else if (f.wire === 0) {
      const small = Number(BigInt.asUintN(32, f.value));
      if (f.field === 4) algorithm = small;
      else if (f.field === 5) digits = small;
      else if (f.field === 6) type = small;
      else if (f.field === 7) counter = f.value;
    }
  }

  let label = name;
  if (issuer && label.startsWith(`${issuer}:`)) {
    label = label.slice(issuer.length + 1);
  } else if (!issuer && label.includes(":")) {
    const colon = label.indexOf(":");
    issuer = label.slice(0, colon);
    label = label.slice(colon + 1);
  }

  return {
    name: issuer ? `${issuer}: ${label.trim()}` : label.trim(),
    draft: {
      type: TYPES[type] ?? `unknown-${type}`,
      secret: base32Encode(secret),
      issuer,
      label,
      algorithm: ALGORITHMS[algorithm] ?? `unknown-${algorithm}`,
      digits: DIGITS[digits] ?? -1,
      counter: Number(counter),
    },
  };
}

export function parseGoogleMigrationUri(
  uri: string,
): ImportResult & { batch: MigrationBatch | null } {
  const match = /^otpauth-migration:\/\/offline\?(.*)$/is.exec(uri.trim());
  if (!match) throw new CoreError("invalid-uri", "Not an otpauth-migration URI");
  const dataParam = (match[1] ?? "").split("&").find((p) => p.toLowerCase().startsWith("data="));
  if (!dataParam) throw new CoreError("invalid-uri", "Missing data parameter");
  let payload: Uint8Array;
  try {
    // decodeURIComponent leaves '+' alone, so raw base64 containing '+' still decodes correctly.
    payload = fromBase64(decodeURIComponent(dataParam.slice(5)));
  } catch (cause) {
    throw new CoreError("invalid-uri", "Invalid data parameter", { cause });
  }

  const result = emptyResult();
  const batch: MigrationBatch = { size: 1, index: 0, id: 0 };
  let sawBatch = false;
  let position = 0;
  for (const field of readFields(payload)) {
    if (field.field === 1 && field.wire === 2) {
      const current = position++;
      let parsed: { name: string; draft: AccountDraft };
      try {
        parsed = parseOtpParameters(field.value);
      } catch (e) {
        result.issues.push({
          position: current,
          name: "",
          reason: "malformed-entry",
          detail: e instanceof Error ? e.message : String(e),
        });
        continue;
      }
      collect(result, current, parsed.name, parsed.draft);
    } else if (field.wire === 0 && field.field >= 3 && field.field <= 5) {
      sawBatch = true;
      if (field.field === 3) batch.size = Number(BigInt.asIntN(32, field.value));
      else if (field.field === 4) batch.index = Number(BigInt.asIntN(32, field.value));
      else batch.id = Number(BigInt.asIntN(32, field.value));
    }
  }
  return { ...result, batch: sawBatch ? batch : null };
}
