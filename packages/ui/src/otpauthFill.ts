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
  const digits = get("digits")?.trim() || "6";
  if (type !== "steam" && !/^\d+$/.test(digits)) return null;
  if (type !== "steam" && (Number(digits) < 6 || Number(digits) > 8)) return null;
  const period = get("period")?.trim() || "30";
  if (type === "totp" && (!/^\d+$/.test(period) || Number(period) < 1 || Number(period) > 300))
    return null;
  const rawCounter = get("counter");
  const counter = Number(rawCounter);
  if (rawCounter !== null && (!Number.isSafeInteger(counter) || counter < 0)) return null;
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
