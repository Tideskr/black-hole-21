'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import enMessages from './locales/en.json';
import zhMessages from './locales/zh-CN.json';

export type Language = 'zh' | 'en';
export type ThemePreference = 'system' | 'light' | 'dark';
export type TranslationKey = keyof typeof enMessages;
type Variables = Record<string, string | number>;

const messages: Record<Language, Record<TranslationKey, string>> = {
  en: enMessages,
  zh: zhMessages,
};

export type Translator = (key: TranslationKey, variables?: Variables) => string;

interface I18nContextValue {
  language: Language;
  locale: string;
  theme: ThemePreference;
  resolvedTheme: 'light' | 'dark';
  setLanguage: (language: Language) => void;
  toggleLanguage: () => void;
  toggleTheme: () => void;
  t: Translator;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, variables?: Variables) {
  if (!variables) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(variables[key] ?? `{${key}}`));
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('zh');
  const [theme, setTheme] = useState<ThemePreference>('system');
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const updateSystemTheme = () => setSystemTheme(media.matches ? 'light' : 'dark');
    const initialTimer = window.setTimeout(() => {
      const storedLanguage = window.localStorage.getItem('black-hole-21-language');
      setLanguageState(storedLanguage === 'en' || storedLanguage === 'zh'
        ? storedLanguage
        : navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en');

      const storedTheme = window.localStorage.getItem('black-hole-21-theme');
      if (storedTheme === 'light' || storedTheme === 'dark') setTheme(storedTheme);
      updateSystemTheme();
    }, 0);
    media.addEventListener('change', updateSystemTheme);
    return () => {
      window.clearTimeout(initialTimer);
      media.removeEventListener('change', updateSystemTheme);
    };
  }, []);

  const resolvedTheme = theme === 'system' ? systemTheme : theme;

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  useEffect(() => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setLanguage = useCallback((nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem('black-hole-21-language', nextLanguage);
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguageState((current) => {
      const next = current === 'zh' ? 'en' : 'zh';
      window.localStorage.setItem('black-hole-21-language', next);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(() => {
      const next = resolvedTheme === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem('black-hole-21-theme', next);
      return next;
    });
  }, [resolvedTheme]);

  const t = useCallback<Translator>((key, variables) => interpolate(messages[language][key], variables), [language]);
  const value = useMemo(() => ({
    language,
    locale: language === 'zh' ? 'zh-CN' : 'en-US',
    theme,
    resolvedTheme,
    setLanguage,
    toggleLanguage,
    toggleTheme,
    t,
  }), [language, resolvedTheme, setLanguage, t, theme, toggleLanguage, toggleTheme]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside PreferencesProvider');
  return context;
}
