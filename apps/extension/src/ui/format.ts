import type { LockPolicy } from "../background/settings";
import type { Translate } from "./i18n/i18n";

/** "492018" → "492 018", "84021937" → "8402 1937"; Steam codes stay as they are. */
export function formatCode(code: string): string {
  if (!/^\d+$/.test(code) || code.length < 6) return code;
  const head = code.length === 6 ? 3 : code.length - 4;
  return `${code.slice(0, head)} ${code.slice(head)}`;
}

/** 0: shorter than 8 characters (rejected) … 4: long passphrase. */
export function passwordStrength(password: string): 0 | 1 | 2 | 3 | 4 {
  if (password.length < 8) return 0;
  if (password.length >= 16) return 4;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && classes >= 3) return 3;
  if (password.length >= 12 || classes >= 3) return 2;
  return 1;
}

export function lockPolicyLabel(t: Translate, policy: LockPolicy): string {
  if (policy.kind === "timeout") return t(`policy.timeout.${policy.minutes}`);
  return t(`policy.${policy.kind}`);
}

/** Footer sentence on the lock screen, e.g. "Tarayıcı kapanınca kilitlenir". */
export function lockPolicySentence(t: Translate, policy: LockPolicy): string {
  if (policy.kind === "timeout") return t(`policy.sentence.timeout.${policy.minutes}`);
  return t(`policy.sentence.${policy.kind}`);
}

export function formatDate(locale: string, ms: number): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(ms));
}

export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const typeLabel = (type: string) => (type === "steam" ? "Steam" : type.toUpperCase());
