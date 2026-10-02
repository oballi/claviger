/** Key order differs between storage backends, so comparisons and digests must not depend on it. */
export function canonicalJson(value: unknown): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v !== null && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
          )
        : v;
  // JSON.stringify(undefined) is undefined; a missing value must still compare as a string.
  return JSON.stringify(sorted(value)) ?? "undefined";
}
