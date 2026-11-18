/**
 * Translations. English text is the key, so code stays readable and anything not yet translated
 * falls back to English. Placeholders are numbered: tr('Paid {0} of {1}', [a, b]).
 *
 * The language is set once from settings before the app renders (see SettingsProvider); changing
 * it re-mounts the app so every screen picks up the new strings.
 */
import { getLocales } from 'expo-localization';
import fr from './fr';
import ha from './ha';
import pcm from './pcm';
import sw from './sw';
import yo from './yo';

export type Language = 'en' | 'fr' | 'sw' | 'ha' | 'yo' | 'pcm';
export type LanguagePreference = 'system' | Language;

export const LANGUAGES: { code: Language; name: string; english: string; locale: string; reviewed: boolean }[] = [
  { code: 'en', name: 'English', english: 'English', locale: 'en', reviewed: true },
  { code: 'fr', name: 'Français', english: 'French', locale: 'fr', reviewed: true },
  { code: 'sw', name: 'Kiswahili', english: 'Swahili', locale: 'sw', reviewed: true },
  { code: 'ha', name: 'Hausa', english: 'Hausa', locale: 'ha', reviewed: false },
  { code: 'yo', name: 'Yorùbá', english: 'Yoruba', locale: 'yo', reviewed: false },
  { code: 'pcm', name: 'Naijá (Pidgin)', english: 'Nigerian Pidgin', locale: 'en-NG', reviewed: false },
];

const DICTIONARIES: Record<Exclude<Language, 'en'>, Record<string, string>> = { fr, sw, ha, yo, pcm };

let current: Language = 'en';

/** The phone's language if BudT has it, otherwise English. */
export function deviceLanguage(): Language {
  for (const locale of getLocales()) {
    const code = locale.languageCode?.toLowerCase();
    if (code && LANGUAGES.some((l) => l.code === code)) return code as Language;
  }
  return 'en';
}

export function resolveLanguage(pref: string | null | undefined): Language {
  if (pref && pref !== 'system' && LANGUAGES.some((l) => l.code === pref)) return pref as Language;
  return deviceLanguage();
}

export function setLanguage(lang: Language) {
  current = lang;
}

export function getLanguage() {
  return current;
}

/** BCP 47 tag for formatting dates in the chosen language. */
export function dateLocale() {
  return LANGUAGES.find((l) => l.code === current)?.locale ?? 'en';
}

/** Translates `text` into the current language, filling {0}, {1}… from `vars`. */
export function tr(text: string, vars?: readonly unknown[]): string {
  const translated = current === 'en' ? text : (DICTIONARIES[current][text] ?? text);
  if (!vars) return translated;
  return translated.replace(/\{(\d+)\}/g, (match, i) => (Number(i) < vars.length ? String(vars[Number(i)]) : match));
}

/**
 * Marks text for translation without translating it yet, for constants defined at module level
 * (before the language is known). Translate where it's shown: tr(item.title).
 */
export const N_ = (text: string) => text;
