import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { ManageKey } from "../manage/i18n/tr";
import { en } from "./en";
import { tr, type PopupKey } from "./tr";

export type Locale = "tr" | "en";
export type MessageKey = PopupKey | ManageKey;
export type ExtraMessages = Record<Locale, Partial<Record<MessageKey, string>>>;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const dictionaries: Record<Locale, Record<PopupKey, string>> = { tr, en };

export function pickLocale(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith("tr") ? "tr" : "en";
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
  extra?: ExtraMessages,
): string {
  // Manage-only strings live in a separate dictionary so the popup bundle never carries them.
  const text = extra?.[locale][key] ?? dictionaries[locale][key as PopupKey] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}

interface LocaleState {
  locale: Locale;
  extra?: ExtraMessages;
}

const LocaleContext = createContext<LocaleState>({ locale: "en" });

export function LocaleProvider({
  locale,
  extra,
  children,
}: {
  locale: Locale;
  extra?: ExtraMessages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, extra }), [locale, extra]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}

export function useT(): Translate {
  const { locale, extra } = useContext(LocaleContext);
  return useCallback<Translate>(
    (key, vars) => translate(locale, key, vars, extra),
    [locale, extra],
  );
}
