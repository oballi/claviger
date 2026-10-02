/** Decodes the capture without fetch(), so nothing but extension code ever touches the pixels. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/png";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** Display name of an otpauth:// link for the result list; secrets are never read. */
export function otpauthName(uri: string): string {
  try {
    const url = new URL(uri);
    const raw = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const colon = raw.indexOf(":");
    const prefix = colon >= 0 ? raw.slice(0, colon).trim() : "";
    const account = (colon >= 0 ? raw.slice(colon + 1) : raw).trim();
    const issuer = url.searchParams.get("issuer") || prefix;
    return issuer && account ? `${issuer} (${account})` : issuer || account;
  } catch {
    return "";
  }
}
