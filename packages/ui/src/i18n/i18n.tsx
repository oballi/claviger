import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ManageKey } from "../manage/i18n/tr";
import { en } from "./en";
import { resolveLocale, type Language, type Locale } from "./locales";
import { tr, type PopupKey } from "./tr";

export { LANGUAGE_VALUES, LOCALES, resolveLocale } from "./locales";
export type { Language, Locale } from "./locales";
export type MessageKey = PopupKey | ManageKey;
export type ExtraMessages = Record<Locale, Partial<Record<MessageKey, string>>>;
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const dictionaries: Record<Locale, Record<PopupKey, string>> = { tr, en };

export function pickLocale(languages: readonly string[]): Locale {
  return resolveLocale("system", languages);
}

// The vault setting is async; this mirror lets the first paint use the right language.
const CACHE_KEY = "claviger-language";

/** Call before the first render: the cached choice, else the browser language. */
export function readCachedLocale(languages: readonly string[]): Locale {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached !== null) return resolveLocale(cached, languages);
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return pickLocale(languages);
}

export function translate(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
  extra?: ExtraMessages,
): string {
  // Manage-only strings live in a separate dictionary so the popup bundle never carries them.
  const text =
    extra?.[locale][key] ??
    dictionaries[locale][key as PopupKey] ??
    extra?.en[key] ??
    dictionaries.en[key as PopupKey] ??
    key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}

interface LocaleState {
  locale: Locale;
  extra?: ExtraMessages;
  systemLanguages: readonly string[];
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState>({
  locale: "en",
  systemLanguages: [],
  setLocale: () => {},
});

/** `locale` is the first paint only; `useLanguageSync` changes it at runtime. */
export function LocaleProvider({
  locale,
  extra,
  systemLanguages,
  children,
}: {
  locale: Locale;
  extra?: ExtraMessages;
  systemLanguages?: readonly string[];
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(locale);
  // Read once: the browser language list is not expected to change while a page is open.
  const [detected] = useState<readonly string[]>(() =>
    typeof navigator === "undefined" ? [] : [...navigator.languages],
  );
  const languages = systemLanguages ?? detected;
  const value = useMemo(
    () => ({ locale: current, extra, systemLanguages: languages, setLocale: setCurrent }),
    [current, extra, languages],
  );
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Reconciles the page language with the stored setting once the state arrives (also while locked). */
export function useLanguageSync(language: Language | undefined): void {
  const { setLocale, systemLanguages } = useContext(LocaleContext);
  useEffect(() => {
    if (language === undefined) return;
    const next = resolveLocale(language, systemLanguages);
    setLocale(next);
    document.documentElement.lang = next;
    try {
      localStorage.setItem(CACHE_KEY, language);
    } catch {
      // Storage can be blocked; the stored setting still applies after load.
    }
  }, [language, systemLanguages, setLocale]);
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
