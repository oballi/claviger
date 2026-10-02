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

const EMAIL = /[^\s@<>()]+@([a-z0-9.-]+\.[a-z0-9-]+)/gi;

function mentionsDomain(text: string, domain: string): boolean {
  for (const m of text.matchAll(EMAIL)) {
    if (m[1] && registrableDomain(m[1]) === domain) return true;
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
