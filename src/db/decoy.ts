/**
 * The decoy database behind the panic PIN.
 *
 * Unlocking with the panic PIN opens this separate database instead of the real one, so every
 * screen shows a believable made-up budget (lib/decoyData.ts) while the real records are never
 * read or changed. Anything done meanwhile (new entries, even "erase all data") only touches the
 * decoy. Each time it opens, it copies the real app's settings (language, currency, theme, budget
 * period) so it looks the same, and adds fake entries for the days since it was last opened.
 */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { tr } from '@/i18n';
import { fakeBudgets, fakeMonthlyIncome, fakeTransactions, niceAmount, shiftDate } from '@/lib/decoyData';
import { todayISO } from '@/lib/dates';
import { keyStatement, type PreparedDatabase } from './encryption';

/** A plain name, so the file itself doesn't announce what it is. */
export const DECOY_DB = 'budit-alt.db';

/** Decoy-only bookkeeping, never copied from the real settings. */
const KEYS = { currency: 'decoyCurrency', income: 'decoyIncome', through: 'decoyThrough' };

/** How far back a fresh decoy's history goes, and the most a later visit fills in at once. */
const HISTORY_DAYS = 75;
const MAX_FILL_DAYS = 400;

/** Rough units per US dollar, for when the real app has never fetched official rates. */
const FALLBACK_PER_USD: Record<string, number> = {
  USD: 1, EUR: 0.9, GBP: 0.8, NGN: 1500, GHS: 15, KES: 130, UGX: 3700, TZS: 2600, RWF: 1400, ZAR: 18,
  ZMW: 26, MWK: 1700, BWP: 13.5, NAD: 18, XOF: 600, XAF: 600, EGP: 50, MAD: 10, TND: 3.1, DZD: 135,
  ETB: 120, MZN: 64, AOA: 900, SLE: 23, LRD: 190, GMD: 70, CDF: 2800, SDG: 600, SOS: 570,
};

type Profile = { settings: { key: string; value: string }[]; currency: string; perUsd: number };

/** Reads the real app's settings and its cached rate for the home currency, then closes it again. */
async function readRealProfile(real: PreparedDatabase): Promise<Profile> {
  const db = await openDatabaseAsync(real.name, { useNewConnection: true });
  try {
    if (real.key) await db.execAsync(keyStatement(real.key));
    const settings = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
    const currency = settings.find((s) => s.key === 'currency')?.value ?? 'USD';
    const rate = await db.getFirstAsync<{ per_usd: number }>('SELECT per_usd FROM fx_rates WHERE currency = ?', currency);
    return { settings, currency, perUsd: rate?.per_usd ?? FALLBACK_PER_USD[currency] ?? 1 };
  } finally {
    await db.closeAsync();
  }
}

const put = (db: SQLiteDatabase, key: string, value: string) =>
  db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

const get = async (db: SQLiteDatabase, key: string) =>
  (await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;

/** Starts the decoy over: one account, a few budgets, a savings goal and a bill. */
async function reset(db: SQLiteDatabase, income: number, today: string, categories: Map<string, number>) {
  await db.execAsync(
    `DELETE FROM transfers; DELETE FROM savings_groups; DELETE FROM debts; DELETE FROM recurring; DELETE FROM budgets;
     DELETE FROM bills; DELETE FROM transactions; DELETE FROM goals; DELETE FROM ious; DELETE FROM challenges; DELETE FROM net_worth;
     DELETE FROM accounts WHERE id <> 1;`,
  );
  await db.runAsync(
    `INSERT INTO accounts (id, name, kind, icon, color, opening_balance) VALUES (1, 'Main account', 'bank', 'wallet', '#0F766E', ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, kind = excluded.kind, opening_balance = excluded.opening_balance, archived = 0, currency = NULL`,
    niceAmount(income * 0.4) * 100,
  );
  for (const b of fakeBudgets(income)) {
    const id = categories.get(b.category);
    if (id) await db.runAsync('INSERT INTO budgets (category_id, amount) VALUES (?, ?)', id, b.amount);
  }
  await db.runAsync(
    'INSERT INTO goals (name, target, saved, color, icon) VALUES (?, ?, ?, ?, ?)',
    tr('Emergency fund'),
    niceAmount(income * 3) * 100,
    niceAmount(income * 0.9) * 100,
    '#10B981',
    'umbrella',
  );
  const utilities = categories.get('Utilities');
  if (utilities) {
    // The next 5th of the month, when the fake electricity payments go out.
    const [y, m, d] = today.split('-').map(Number);
    const [dueY, dueM] = d < 5 ? [y, m] : m === 12 ? [y + 1, 1] : [y, m + 1];
    const due = `${dueY}-${String(dueM).padStart(2, '0')}-05`;
    await db.runAsync(
      "INSERT INTO bills (name, amount, category_id, due_date, frequency) VALUES (?, ?, ?, ?, 'monthly')",
      tr('Electricity'),
      niceAmount(income * 0.03) * 100,
      utilities,
      due,
    );
  }
}

/** Runs when the decoy database opens (after migrations). Never throws: a thin decoy beats a crash. */
export async function prepareDecoy(db: SQLiteDatabase, real: PreparedDatabase) {
  let profile: Profile;
  try {
    profile = await readRealProfile(real);
  } catch (e) {
    console.warn('Couldn’t read settings for the decoy', e);
    profile = { settings: [], currency: 'USD', perUsd: 1 };
  }
  try {
    const today = todayISO();
    const categories = new Map((await db.getAllAsync<{ id: number; name: string }>('SELECT id, name FROM categories')).map((c) => [c.name, c.id]));
    await db.withTransactionAsync(async () => {
      // Look like the real app: same language, currency, theme and budget period.
      for (const s of profile.settings) if (!s.key.startsWith('decoy')) await put(db, s.key, s.value);
      await put(db, 'onboarded', '1');

      // A new currency means new amounts: start over. Otherwise carry on from the last visit.
      const sameCurrency = (await get(db, KEYS.currency)) === profile.currency;
      const storedIncome = Number(await get(db, KEYS.income));
      const income = sameCurrency && storedIncome > 0 ? storedIncome : fakeMonthlyIncome(profile.perUsd);
      const through = sameCurrency ? await get(db, KEYS.through) : null;
      if (!through) await reset(db, income, today, categories);
      const earliest = shiftDate(today, -(through ? MAX_FILL_DAYS : HISTORY_DAYS));
      const from = through && through >= earliest ? shiftDate(through, 1) : earliest;

      for (const tx of fakeTransactions(from, today, income)) {
        const id = categories.get(tx.category);
        if (id) await db.runAsync("INSERT INTO transactions (type, amount, category_id, account_id, date, note) VALUES (?, ?, ?, 1, ?, '')", tx.type, tx.amount, id, tx.date);
      }
      await put(db, KEYS.currency, profile.currency);
      await put(db, KEYS.income, String(income));
      await put(db, KEYS.through, today);
    });
  } catch (e) {
    console.warn('Decoy setup failed', e);
  }
}
