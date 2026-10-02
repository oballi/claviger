import { parse } from "tldts";

function hostnameOf(input: string): string | null {
  const raw = input.trim().toLowerCase();
  if (!raw) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/.test(raw) && !/^[^/]*:\d+/.test(raw);
  if (hasScheme && !/^https?:\/\//.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  return host || null;
}

/** Registrable domain (eTLD+1). IP addresses and dotless hosts are returned as-is. */
export function registrableDomain(input: string): string | null {
  const host = hostnameOf(input);
  if (!host) return null;
  const parsed = parse(host, { allowPrivateDomains: true });
  if (parsed.isIp) return host;
  if (parsed.domain) return parsed.domain;
  return host.includes(".") ? null : host;
}

/** Only accounts the user linked (`domains`) match; names are never guessed from. */
export function matchAccounts<T extends { domains: string[] }>(
  accounts: T[],
  pageUrl: string,
): { exact: T[] } {
  const domain = registrableDomain(pageUrl);
  if (!domain) return { exact: [] };
  return { exact: accounts.filter((a) => a.domains.includes(domain)) };
}
