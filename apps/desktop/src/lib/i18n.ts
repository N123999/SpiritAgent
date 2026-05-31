import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from '../locales/en.json';
import zhCN from '../locales/zh-CN.json';

export const DEFAULT_LANGUAGE = 'zh-CN';
export const VALID_LANGUAGES: readonly string[] = ['zh-CN', 'en'];
export const LANGUAGE_STORAGE_KEY = 'spirit-agent-desktop-language' as const;

export function isValidLanguage(v: string): v is 'zh-CN' | 'en' {
  return VALID_LANGUAGES.includes(v);
}

export function detectSystemLanguage(): string {
  if (typeof navigator === 'undefined') {
    return DEFAULT_LANGUAGE;
  }
  const lang = navigator.language;
  if (isValidLanguage(lang)) {
    return lang;
  }
  if (lang.startsWith('zh')) {
    return 'zh-CN';
  }
  return DEFAULT_LANGUAGE;
}

export function getStoredLanguage(): string {
  if (typeof localStorage === 'undefined') {
    return detectSystemLanguage();
  }
  const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (raw && isValidLanguage(raw)) {
    return raw;
  }
  return detectSystemLanguage();
}

export function setStoredLanguage(lang: string): void {
  localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
}

export async function changeLanguage(lang: string): Promise<void> {
  if (!isValidLanguage(lang)) {
    return;
  }
  setStoredLanguage(lang);
  await i18n.changeLanguage(lang);
  if (typeof window !== 'undefined' && window.spiritDesktop) {
    window.spiritDesktop.syncLanguage?.(lang).catch(() => {
      // ignore IPC errors
    });
  }
}

i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: getStoredLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
