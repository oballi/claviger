export interface LocaleEntry {
  code: string;
  /** Written in the language itself and never translated. */
  native: string;
}

export const LOCALES = [
  { code: "tr", native: "Türkçe" },
  { code: "en", native: "English" },
] as const satisfies readonly LocaleEntry[];

export type Locale = (typeof LOCALES)[number]["code"];

// Plain constants only: the popup bundle must not pull zod in through this file.
export const LANGUAGE_VALUES = ["system", "tr", "en"] as const;
export type Language = (typeof LANGUAGE_VALUES)[number];

// Fails to compile when the registry and the language values drift apart.
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const registryMatchesValues: Equal<Language, "system" | Locale> = true;
void registryMatchesValues;

const FALLBACK: Locale = "en";

const isLocale = (v: unknown): v is Locale => LOCALES.some((l) => l.code === v);

/** "system" and unknown values follow the browser languages (first prefix match), else English. */
export function resolveLocale(language: string, languages: readonly string[]): Locale {
  if (isLocale(language)) return language;
  for (const tag of languages) {
    const prefix = tag.toLowerCase().split("-")[0];
    const hit = LOCALES.find((l) => l.code === prefix);
    if (hit) return hit.code;
  }
  return FALLBACK;
}
