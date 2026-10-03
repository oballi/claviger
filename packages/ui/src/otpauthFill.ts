export type OtpauthFill = {
  issuer: string;
  label: string;
  secret: string;
  type: "totp" | "hotp" | "steam";
  algorithm: string;
  digits: string;
  period: string;
  counter?: number;
};

const decode = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/**
 * Pre-fill only: the background parser stays authoritative on submit. A malformed or
 * unsupported link returns null so the pasted text is left as typed.
 */
export function parseOtpauthFill(text: string): OtpauthFill | null {
  const match = /^otpauth:\/\/([a-z0-9]+)\/([^?]*)(?:\?(.*))?$/i.exec(text.trim());
  if (!match) return null;
  const rawType = (match[1] ?? "").toLowerCase();
  const params = new URLSearchParams(match[3] ?? "");
  const get = (name: string): string | null => {
    for (const [key, value] of params) if (key.toLowerCase() === name) return value;
    return null;
  };
  const secret = get("secret")?.trim();
  if (!secret) return null;
  const type = get("encoder")?.toLowerCase() === "steam" ? "steam" : rawType;
  if (type !== "totp" && type !== "hotp" && type !== "steam") return null;

  const labelText = decode(match[2] ?? "");
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

  const algorithm = (get("algorithm") ?? "SHA1").toUpperCase().replace(/-/g, "");
  if (!["SHA1", "SHA256", "SHA512"].includes(algorithm)) return null;
  // Mirrors core: every numeric parameter must be finite, whatever the type (Steam ignores the value).
  const numeric = (name: string): string | null => get(name)?.trim() || null;
  if (["digits", "period", "counter"].some((n) => !Number.isFinite(Number(numeric(n) ?? 0))))
    return null;
  const digits = numeric("digits") ?? "6";
  const period = numeric("period") ?? "30";
  const rawCounter = numeric("counter");
  const counter = Number(rawCounter ?? 0);
  if (type !== "steam") {
    if (!/^\d+$/.test(digits) || Number(digits) < 6 || Number(digits) > 8) return null;
    if (!/^\d+$/.test(period) || Number(period) < 1 || Number(period) > 300) return null;
    if (!Number.isSafeInteger(counter) || counter < 0) return null;
  }
  return {
    issuer: issuer.trim(),
    label: label.trim(),
    secret,
    type,
    algorithm,
    digits,
    period,
    ...(type === "hotp" && rawCounter !== null ? { counter } : {}),
  };
}
