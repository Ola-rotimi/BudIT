import { useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Appearance } from 'react-native';
import { getSetting, setSetting } from '@/db/queries';
import { resolveLanguage, setLanguage as applyLanguage, type LanguagePreference } from '@/i18n';
import { setPeriodStartDay } from './dates';
import { CUSTOM_COUNTRY, getCountry } from './countries';
import { formatMajor, formatMoney } from './money';
import type { ThemePreference } from './theme';

type Settings = {
  currency: string;
  /** False until the user has picked a currency (directly or via their country) at least once. */
  currencyChosen: boolean;
  setCurrency: (code: string) => Promise<void>;
  /** The user's home country code, or null if not chosen yet. */
  country: string | null;
  /** Sets the home country, its currency, and the country the calculators use. */
  setCountry: (code: string) => Promise<void>;
  /** Country whose rules the tax and pension calculators apply (or `CUSTOM_COUNTRY`). */
  calcCountry: string;
  setCalcCountry: (code: string) => Promise<void>;
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => Promise<void>;
  /** False until the first-launch walkthrough is finished or skipped. */
  onboarded: boolean;
  setOnboarded: (done: boolean) => Promise<void>;
  /** Masks every balance and amount on screen (e.g. when using the app in public). */
  hideAmounts: boolean;
  setHideAmounts: (hide: boolean) => Promise<void>;
  /** Day of the month budget periods start (1 = calendar months; e.g. 25 for a payday on the 25th). */
  monthStartDay: number;
  setMonthStartDay: (day: number) => Promise<void>;
  /** 'system' follows the phone's language (when BudIT has it). */
  language: LanguagePreference;
  setLanguage: (lang: LanguagePreference) => Promise<void>;
  /** Re-reads every setting from the database, e.g. after restoring a backup. */
  reload: () => Promise<void>;
};

type Stored = {
  currency: string | null;
  country: string | null;
  calcCountry: string | null;
  theme: string | null;
  onboarded: string | null;
  hideAmounts: string | null;
  monthStartDay: string | null;
  language: string | null;
};

const SettingsContext = createContext<Settings | null>(null);

/** Pins the whole app (including native pickers and alerts) to light/dark, or follows the system. */
function applyTheme(theme: string | null) {
  Appearance.setColorScheme(theme === 'light' || theme === 'dark' ? theme : 'auto');
}

async function readAll(db: SQLiteDatabase): Promise<Stored> {
  const [currency, country, calcCountry, theme, onboarded, hideAmounts, monthStartDay, language] = await Promise.all(
    ['currency', 'country', 'calcCountry', 'theme', 'onboarded', 'hideAmounts', 'monthStartDay', 'language'].map((key) => getSetting(db, key)),
  );
  applyLanguage(resolveLanguage(language));
  applyTheme(theme);
  // Applied before anything renders so every date range uses the same budget periods.
  setPeriodStartDay(Number(monthStartDay) || 1);
  // Installs from before the walkthrough existed count as onboarded if a country was already set.
  // Decided once here at load, so picking a country during the walkthrough doesn't end it early.
  return { currency, country, calcCountry, theme, onboarded: onboarded ?? (country ? '1' : '0'), hideAmounts, monthStartDay, language };
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [stored, setStored] = useState<Stored>();

  useEffect(() => {
    readAll(db).then(setStored);
  }, [db]);

  const update = useCallback(
    async (changes: Partial<Stored>) => {
      for (const [key, value] of Object.entries(changes)) {
        if (value) await setSetting(db, key, value);
      }
      setStored((s) => (s ? { ...s, ...changes } : s));
    },
    [db],
  );

  const value = useMemo<Settings | null>(() => {
    if (!stored) return null;
    return {
      currency: stored.currency ?? 'USD',
      currencyChosen: !!stored.currency,
      setCurrency: (code) => update({ currency: code }),
      country: stored.country,
      setCountry: (code) => {
        const preset = getCountry(code);
        return update({ country: code, calcCountry: code, ...(preset && { currency: preset.currency }) });
      },
      calcCountry: stored.calcCountry ?? stored.country ?? CUSTOM_COUNTRY,
      setCalcCountry: (code) => update({ calcCountry: code }),
      theme: stored.theme === 'light' || stored.theme === 'dark' ? stored.theme : 'system',
      setTheme: (theme) => {
        applyTheme(theme);
        return update({ theme });
      },
      onboarded: stored.onboarded === '1',
      setOnboarded: (done) => update({ onboarded: done ? '1' : '0' }),
      hideAmounts: stored.hideAmounts === '1',
      setHideAmounts: (hide) => update({ hideAmounts: hide ? '1' : '0' }),
      monthStartDay: Number(stored.monthStartDay) || 1,
      setMonthStartDay: (day) => {
        setPeriodStartDay(day);
        // Saving notifies every query, so lists and budgets reload with the new periods.
        return update({ monthStartDay: String(day) });
      },
      language: (stored.language as LanguagePreference | null) ?? 'system',
      setLanguage: (lang) => {
        applyLanguage(resolveLanguage(lang));
        return update({ language: lang });
      },
      reload: () => readAll(db).then(setStored),
    };
  }, [db, stored, update]);

  if (!value) return null;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}

/**
 * Formatters bound to the user's currency, or to `override` (e.g. another country's calculator).
 * `money` (the user's own records) is masked while "hide amounts" is on; `major` (calculator
 * figures the user typed in) is not.
 */
export function useMoney(override?: string) {
  const settings = useSettings();
  const currency = override ?? settings.currency;
  // (In safe mode this is the decoy's setting, and its made-up figures are fine to show.)
  const hide = settings.hideAmounts;
  return useMemo(
    () => ({
      currency,
      hidden: hide,
      money: (cents: number, opts?: { compact?: boolean; sign?: boolean }) =>
        hide ? maskMoney(formatMoney(0, currency, opts)) : formatMoney(cents, currency, opts),
      /** Like `money`, for an amount in another currency (e.g. a USD account). Null means the home currency. */
      moneyIn: (cents: number, code: string | null | undefined, opts?: { compact?: boolean; sign?: boolean }) => {
        const c = code || settings.currency;
        return hide ? maskMoney(formatMoney(0, c, opts)) : formatMoney(cents, c, opts);
      },
      major: (value: number, compact = false) => formatMajor(value, currency, compact),
    }),
    [currency, hide, settings.currency],
  );
}

/** Replaces the digits of a formatted amount with dots, keeping the currency symbol: "₦0.00" → "₦•••••". */
export const maskMoney = (formatted: string) => formatted.replace(/\d(?:[\d.,'\s]*\d)?/, '•••••');
