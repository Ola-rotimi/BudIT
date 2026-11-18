/**
 * Currency conversion inside the database layer, for accounts held in another currency.
 *
 * Uses only the cached official rates in `fx_rates` (kept fresh by lib/fx), so it works offline
 * and never blocks on the network. Every rate is units per 1 US dollar; cross rates go via USD.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

/** No official rate has been downloaded yet for one of the currencies. */
export class MissingRateError extends Error {
  currency: string;
  constructor(currency: string) {
    super(`No exchange rate for ${currency}`);
    this.currency = currency;
  }
}

export async function homeCurrency(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>("SELECT value FROM settings WHERE key = 'currency'");
  return row?.value ?? 'USD';
}

/** Units of each cached currency per 1 US dollar. */
export async function cachedRates(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<{ currency: string; per_usd: number }>('SELECT currency, per_usd FROM fx_rates');
  const rates = new Map(rows.map((r) => [r.currency, r.per_usd]));
  rates.set('USD', 1);
  return rates;
}

/** Converts minor units between currencies with cached rates; null when a rate is missing. */
export function convertWith(rates: Map<string, number>, cents: number, from: string, to: string) {
  if (from === to) return cents;
  const a = rates.get(from);
  const b = rates.get(to);
  if (!a || !b) return null;
  return Math.round((cents * b) / a);
}

export async function convertCents(db: SQLiteDatabase, cents: number, from: string, to: string) {
  const converted = convertWith(await cachedRates(db), cents, from, to);
  if (converted === null) throw new MissingRateError(from === to ? to : `${from}/${to}`);
  return converted;
}

/** The account's currency when it differs from the home currency; null for home-currency accounts. */
export async function foreignCurrencyOf(db: SQLiteDatabase, accountId: number | null | undefined) {
  if (!accountId) return null;
  const row = await db.getFirstAsync<{ currency: string | null }>('SELECT currency FROM accounts WHERE id = ?', accountId);
  const home = await homeCurrency(db);
  return row?.currency && row.currency !== home ? row.currency : null;
}

/**
 * Column values for a transaction of `cents` in the account's own currency: `amount` in the home
 * currency (so totals and budgets add up) plus the original amount for foreign-currency accounts.
 */
export async function amountsFor(db: SQLiteDatabase, accountId: number | null | undefined, cents: number) {
  const foreign = await foreignCurrencyOf(db, accountId);
  if (!foreign) return { amount: cents, orig_amount: null, orig_currency: null };
  return { amount: await convertCents(db, cents, foreign, await homeCurrency(db)), orig_amount: cents, orig_currency: foreign };
}

/** Same, for an amount given in the home currency (e.g. a bill paid from a USD account). */
export async function amountsFromHome(db: SQLiteDatabase, accountId: number | null | undefined, homeCents: number) {
  const foreign = await foreignCurrencyOf(db, accountId);
  if (!foreign) return { amount: homeCents, orig_amount: null, orig_currency: null };
  return { amount: homeCents, orig_amount: await convertCents(db, homeCents, await homeCurrency(db), foreign), orig_currency: foreign };
}
