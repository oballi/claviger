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

/** Kayıtlı alan adı (eTLD+1). IP adresleri ve noktasız hostlar olduğu gibi döner. */
export function registrableDomain(input: string): string | null {
  const host = hostnameOf(input);
  if (!host) return null;
  const parsed = parse(host, { allowPrivateDomains: true });
  if (parsed.isIp) return host;
  if (parsed.domain) return parsed.domain;
  return host.includes(".") ? null : host;
}

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function matchAccounts<T extends { issuer: string; domains: string[] }>(
  accounts: T[],
  pageUrl: string,
): { exact: T[]; suggested: T[] } {
  const domain = registrableDomain(pageUrl);
  if (!domain) return { exact: [], suggested: [] };
  const exact = accounts.filter((a) => a.domains.includes(domain));
  const label = alnum(domain.split(".")[0] ?? "");
  const suggested =
    label.length >= 3
      ? accounts.filter((a) => !exact.includes(a) && alnum(a.issuer) === label)
      : [];
  return { exact, suggested };
}
