import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { type Language, translations } from './translations';

const LANGUAGE_STORAGE_KEY = 'mirqab.language';
const RTL_LANGUAGES: Language[] = ['ar'];

interface LanguageContextValue {
  language: Language;
  dir: 'rtl' | 'ltr';
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  /** Dot-path lookup, e.g. `t('auth.login.title')`. Falls back to the key itself if missing. */
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function resolveInitialLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'ar' || stored === 'en') return stored;
  // Arabic-first product — default to ar rather than sniffing navigator.language.
  return 'ar';
}

function lookup(dict: Record<string, unknown>, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
  return typeof value === 'string' ? value : undefined;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(resolveInitialLanguage);
  const dir: 'rtl' | 'ltr' = RTL_LANGUAGES.includes(language) ? 'rtl' : 'ltr';

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = dir;
  }, [language, dir]);

  const setLanguage = useCallback((next: Language) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    setLanguageState(next);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'ar' ? 'en' : 'ar');
  }, [language, setLanguage]);

  const t = useCallback(
    (key: string) => lookup(translations[language], key) ?? lookup(translations.en, key) ?? key,
    [language],
  );

  const value = useMemo(
    () => ({ language, dir, setLanguage, toggleLanguage, t }),
    [language, dir, setLanguage, toggleLanguage, t],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
