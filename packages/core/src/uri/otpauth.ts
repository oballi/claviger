import { normalizeAccountInput, type AccountDraft, type AccountInput } from "../account/account";
import { CoreError } from "../errors";

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

export function parseOtpauthUri(uri: string): AccountInput {
  const match = /^otpauth:\/\/([a-z0-9]+)\/([^?]*)(?:\?(.*))?$/i.exec(uri.trim());
  if (!match) throw new CoreError("invalid-uri", "Not an otpauth:// URI");
  const [, rawType = "", rawLabel = "", query = ""] = match;

  const params = new URLSearchParams(query);
  const get = (name: string): string | null => {
    for (const [key, value] of params) if (key.toLowerCase() === name) return value;
    return null;
  };
  const num = (name: string): number | undefined => {
    const value = get(name);
    if (value === null || value.trim() === "") return undefined;
    const n = Number(value);
    if (!Number.isFinite(n)) throw new CoreError("invalid-uri", `Invalid ${name} parameter`);
    return n;
  };

  const secret = get("secret");
  if (!secret) throw new CoreError("invalid-uri", "Missing secret parameter");

  const labelText = safeDecode(rawLabel);
  const issuerParam = get("issuer");
  let issuer: string;
  let label: string;
  if (issuerParam && labelText.startsWith(`${issuerParam}:`)) {
    issuer = issuerParam;
    label = labelText.slice(issuerParam.length + 1);
  } else {
    const colon = labelText.indexOf(":");
    issuer = issuerParam || (colon === -1 ? "" : labelText.slice(0, colon));
    label = colon === -1 ? labelText : labelText.slice(colon + 1);
  }

  const draft: AccountDraft = {
    type: get("encoder")?.toLowerCase() === "steam" ? "steam" : rawType,
    secret,
    issuer,
    label,
    algorithm: get("algorithm") ?? undefined,
    digits: num("digits"),
    period: num("period"),
    counter: num("counter"),
  };
  return normalizeAccountInput(draft);
}

export function toOtpauthUri(a: AccountInput): string {
  const labelPart = a.issuer ? `${a.issuer}:${a.label}` : a.label;
  const params = new URLSearchParams({ secret: a.secret });
  if (a.issuer) params.set("issuer", a.issuer);
  params.set("algorithm", a.algorithm);
  params.set("digits", String(a.digits));
  if (a.type === "hotp") params.set("counter", String(a.counter));
  else params.set("period", String(a.period));
  return `otpauth://${a.type}/${encodeURIComponent(labelPart)}?${params.toString()}`;
}
