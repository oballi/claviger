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

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Page host labels outside the public suffix, without "www". */
function hostLabels(input: string): string[] {
  const host = hostnameOf(input);
  if (!host) return [];
  const parsed = parse(host, { allowPrivateDomains: true });
  if (parsed.isIp) return [];
  const base = !host.includes(".")
    ? host
    : parsed.publicSuffix
      ? host.slice(0, Math.max(0, host.length - parsed.publicSuffix.length - 1))
      : host;
  return base
    .split(".")
    .map(alnum)
    .filter((l) => l.length >= 3 && l !== "www");
}

const MAX_SCAN = 512;
const MAX_HOST = 253;
const HOST_CHAR = /[a-z0-9.-]/;

/** Bounded scan: only the first 512 chars are read, so hostile labels cannot cost more than that. */
function mentionsDomain(text: string, domain: string): boolean {
  const head = text.slice(0, MAX_SCAN).toLowerCase();
  for (let at = head.indexOf("@"); at !== -1; at = head.indexOf("@", at + 1)) {
    let end = at + 1;
    while (end < head.length && end - at - 1 < MAX_HOST && HOST_CHAR.test(head[end]!)) end++;
    const host = head.slice(at + 1, end);
    if (at > 0 && host.includes(".") && registrableDomain(host) === domain) return true;
  }
  return false;
}

/**
 * Suggestions are hints only and never authorise a fill; fill checks `domains` alone.
 * Order: exact matches first, then suggestions in list order.
 */
export function matchAccounts<T extends { issuer: string; label?: string; domains: string[] }>(
  accounts: T[],
  pageUrl: string,
): { exact: T[]; suggested: T[] } {
  const domain = registrableDomain(pageUrl);
  if (!domain) return { exact: [], suggested: [] };
  const exact = accounts.filter((a) => a.domains.includes(domain));
  const labels = new Set(hostLabels(pageUrl));
  const suggested = accounts.filter((a) => {
    if (exact.includes(a)) return false;
    const issuer = alnum(a.issuer);
    if (issuer.length >= 3 && labels.has(issuer)) return true;
    return mentionsDomain(a.label ?? "", domain) || mentionsDomain(a.issuer, domain);
  });
  return { exact, suggested };
}
