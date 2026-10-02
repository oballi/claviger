import { createContext, useCallback, useContext, type ReactNode } from "react";
import { en } from "./en";
import { tr, type MessageKey } from "./tr";

export type Locale = "tr" | "en";
export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const dictionaries: Record<Locale, Record<MessageKey, string>> = { tr, en };

export function pickLocale(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  return dictionaries[locale][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useT(): Translate {
  const locale = useLocale();
  return useCallback<Translate>((key, vars) => translate(locale, key, vars), [locale]);
}
