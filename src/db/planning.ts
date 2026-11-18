/**
 * Queries for the planning features: safe to spend, net worth, IOUs and spending challenges.
 * Kept apart from queries.ts, which holds the core records.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import { addDays, fromISODate, todayISO, toISODate } from '@/lib/dates';
import { amountsFromHome, cachedRates, convertWith, homeCurrency } from './currency';
import { notifyChange } from './events';
import { listAccounts, listBills, listGroups, listRecurring, type AccountRow } from './queries';
import type { Challenge, ChallengeKind, Iou, IouDirection, TxType } from './types';

// ---------- Safe to spend ----------

/** Everything the safe-to-spend calculation needs, with recurring amounts in the home currency. */
export async function safeToSpendData(db: SQLiteDatabase) {
  const [accounts, bills, recurring, groups, home, rates] = await Promise.all([
    listAccounts(db),
    listBills(db),
    listRecurring(db),
    listGroups(db),
    homeCurrency(db),
    cachedRates(db),
  ]);
  const accountCurrency = new Map(accounts.map((a) => [a.id, a.currency]));
  return {
    accounts,
    bills,
    groups,
    recurring: recurring.map((r) => {
      const currency = (r.account_id && accountCurrency.get(r.account_id)) || home;
      return { ...r, amount: convertWith(rates, r.amount, currency, home) ?? 0 };
    }),
  };
}

// ---------- Net worth ----------

export type NetWorthPoint = { month: string; assets: number; liabilities: number };

/** What you own and owe right now, in the home currency. */
export async function netWorthNow(db: SQLiteDatabase) {
  const [accounts, debts, ious] = await Promise.all([
    listAccounts(db),
    db.getAllAsync<{ name: string; balance: number }>('SELECT name, balance FROM debts WHERE balance > 0'),
    iouTotals(db),
  ]);
  const counted = accounts.filter((a) => a.home_balance !== null);
  const assets = counted.reduce((s, a) => s + Math.max(0, a.home_balance!), 0) + ious.owedToMe;
  const accountDebt = counted.reduce((s, a) => s + Math.max(0, -a.home_balance!), 0);
  const loans = debts.reduce((s, d) => s + d.balance, 0);
  return {
    assets,
    liabilities: accountDebt + loans + ious.iOwe,
    accounts,
    /** Accounts left out because their exchange rate hasn't been downloaded. */
    unconverted: accounts.filter((a) => a.home_balance === null),
    parts: { accountDebt, loans, owedToMe: ious.owedToMe, iOwe: ious.iOwe },
  };
}

const monthOf = (iso: string) => iso.slice(0, 7);

/** Saves this calendar month's figures (overwritten until the month ends). */
export async function recordNetWorth(db: SQLiteDatabase, today = todayISO()) {
  const now = await netWorthNow(db);
  await db.runAsync(
    `INSERT INTO net_worth (month, assets, liabilities, recorded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(month) DO UPDATE SET assets = excluded.assets, liabilities = excluded.liabilities, recorded_at = excluded.recorded_at`,
    monthOf(today), now.assets, now.liabilities, new Date().toISOString(),
  );
}

/**
 * Fills in up to `months` earlier months from transaction history, the first time net worth is
 * used, so the chart isn't empty. Account balances are exact as of each month end; debts and
 * IOUs only count from when they were added, at their current amounts; foreign-currency accounts
 * use today's rate. Months already recorded are left alone.
 */
export async function backfillNetWorth(db: SQLiteDatabase, months = 11, today = todayISO()) {
  const home = await homeCurrency(db);
  const rates = await cachedRates(db);
  const accounts = await db.getAllAsync<{ id: number; opening_balance: number; currency: string | null; created_at: string; archived: number }>(
    'SELECT id, opening_balance, currency, created_at, archived FROM accounts',
  );
  const first = await db.getFirstAsync<{ d: string | null }>('SELECT MIN(date) AS d FROM transactions');
  if (!first?.d) return;
  const existing = new Set((await db.getAllAsync<{ month: string }>('SELECT month FROM net_worth')).map((r) => r.month));

  for (let i = months; i >= 1; i--) {
    const d = fromISODate(`${monthOf(today)}-01`);
    d.setMonth(d.getMonth() - i + 1);
    const end = toISODate(d); // first day of the following month: balances "as of" the month's end
    d.setMonth(d.getMonth() - 1);
    const month = toISODate(d).slice(0, 7);
    if (existing.has(month) || end <= first.d) continue;

    let assets = 0;
    let liabilities = 0;
    for (const a of accounts) {
      if (a.created_at.slice(0, 10) >= end) continue;
      const row = await db.getFirstAsync<{ b: number }>(
        `SELECT ? + COALESCE((SELECT SUM(CASE WHEN type = 'income' THEN 1 ELSE -1 END * COALESCE(orig_amount, amount)) FROM transactions WHERE account_id = ? AND date < ?), 0)
           - COALESCE((SELECT SUM(amount) FROM transfers WHERE from_account = ? AND date < ?), 0)
           + COALESCE((SELECT SUM(COALESCE(to_amount, amount)) FROM transfers WHERE to_account = ? AND date < ?), 0) AS b`,
        a.opening_balance, a.id, end, a.id, end, a.id, end,
      );
      const balance = convertWith(rates, row?.b ?? 0, a.currency && a.currency !== home ? a.currency : home, home);
      if (balance === null) continue;
      if (balance >= 0) assets += balance;
      else liabilities -= balance;
    }
    const debts = await db.getFirstAsync<{ n: number }>('SELECT COALESCE(SUM(balance), 0) AS n FROM debts WHERE balance > 0 AND substr(created_at, 1, 10) < ?', end);
    const ious = await db.getAllAsync<{ direction: IouDirection; left: number }>('SELECT direction, amount - repaid AS left FROM ious WHERE date < ? AND amount > repaid', end);
    liabilities += debts?.n ?? 0;
    for (const o of ious) {
      if (o.direction === 'owed_to_me') assets += o.left;
      else liabilities += o.left;
    }
    await db.runAsync('INSERT OR IGNORE INTO net_worth (month, assets, liabilities, recorded_at) VALUES (?, ?, ?, ?)', month, assets, liabilities, new Date().toISOString());
  }
}

export function netWorthHistory(db: SQLiteDatabase, limit = 12) {
  return db
    .getAllAsync<NetWorthPoint>('SELECT month, assets, liabilities FROM net_worth ORDER BY month DESC LIMIT ?', limit)
    .then((rows) => rows.reverse());
}

// ---------- IOUs (money lent and borrowed) ----------

export type IouRow = Iou & { outstanding: number };

export function listIous(db: SQLiteDatabase, includeSettled = false) {
  return db.getAllAsync<IouRow>(
    `SELECT *, amount - repaid AS outstanding FROM ious ${includeSettled ? '' : 'WHERE repaid < amount'}
     ORDER BY (repaid >= amount), due_date IS NULL, due_date, date DESC, id DESC`,
  );
}

export function getIou(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<IouRow>('SELECT *, amount - repaid AS outstanding FROM ious WHERE id = ?', id);
}

export async function iouTotals(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ owedToMe: number; iOwe: number }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'owed_to_me' THEN amount - repaid END), 0) AS owedToMe,
            COALESCE(SUM(CASE WHEN direction = 'i_owe' THEN amount - repaid END), 0) AS iOwe
     FROM ious WHERE repaid < amount`,
  );
  return row ?? { owedToMe: 0, iOwe: 0 };
}

export async function saveIou(db: SQLiteDatabase, o: Pick<Iou, 'person' | 'direction' | 'amount' | 'note' | 'date' | 'due_date'> & { id?: number }) {
  if (o.id) {
    await db.runAsync(
      'UPDATE ious SET person = ?, direction = ?, amount = ?, note = ?, date = ?, due_date = ? WHERE id = ?',
      o.person, o.direction, o.amount, o.note, o.date, o.due_date, o.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO ious (person, direction, amount, note, date, due_date) VALUES (?, ?, ?, ?, ?, ?)',
      o.person, o.direction, o.amount, o.note, o.date, o.due_date,
    );
  }
  notifyChange();
}

export async function deleteIou(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM ious WHERE id = ?', id);
  notifyChange();
}

async function categoryByName(db: SQLiteDatabase, name: string, type: TxType) {
  const row =
    (await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? AND type = ? ORDER BY archived LIMIT 1', name, type)) ??
    (await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE type = ? AND archived = 0 ORDER BY id LIMIT 1', type));
  return row!.id;
}

/**
 * Records a repayment of `amount` (home currency). With an account, the money is also recorded
 * there: income when someone pays you back, spending when you pay someone.
 */
export async function recordRepayment(db: SQLiteDatabase, iou: Iou, amount: number, accountId: number | null, date = todayISO()) {
  const pay = Math.min(amount, iou.amount - iou.repaid);
  if (pay <= 0) return;
  const received = iou.direction === 'owed_to_me';
  const tx = accountId ? await amountsFromHome(db, accountId, pay) : null;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE ious SET repaid = repaid + ? WHERE id = ?', pay, iou.id);
    if (tx && accountId) {
      const type: TxType = received ? 'income' : 'expense';
      await db.runAsync(
        'INSERT INTO transactions (type, amount, orig_amount, orig_currency, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        type, tx.amount, tx.orig_amount, tx.orig_currency, await categoryByName(db, received ? 'Other Income' : 'Other', type), accountId, date,
        received ? `Repaid by ${iou.person}` : `Repaid to ${iou.person}`,
      );
    }
  });
  notifyChange();
}

/**
 * Splits a bill you paid: optionally records the whole bill as spending from an account, and
 * creates an IOU for each other person's share. Shares are split evenly; any leftover cent stays with you.
 */
export async function splitBill(
  db: SQLiteDatabase,
  s: { total: number; people: string[]; includeMe: boolean; note: string; date: string; accountId: number | null; categoryId: number | null },
) {
  const heads = s.people.length + (s.includeMe ? 1 : 0);
  const share = Math.floor(s.total / heads);
  const tx = s.accountId && s.categoryId ? await amountsFromHome(db, s.accountId, s.total) : null;
  await db.withTransactionAsync(async () => {
    if (tx && s.accountId && s.categoryId) {
      await db.runAsync(
        'INSERT INTO transactions (type, amount, orig_amount, orig_currency, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        'expense', tx.amount, tx.orig_amount, tx.orig_currency, s.categoryId, s.accountId, s.date, s.note,
      );
    }
    for (const person of s.people) {
      await db.runAsync(
        'INSERT INTO ious (person, direction, amount, note, date) VALUES (?, ?, ?, ?, ?)',
        person, 'owed_to_me', share, s.note ? `Share of ${s.note}` : 'Split bill', s.date,
      );
    }
  });
  notifyChange();
  return share;
}

// ---------- Spending challenges ----------

export function listChallenges(db: SQLiteDatabase) {
  return db.getAllAsync<Challenge & { category_name: string | null }>(
    `SELECT ch.*, c.name AS category_name FROM challenges ch LEFT JOIN categories c ON c.id = ch.category_id
     WHERE ch.active = 1 ORDER BY ch.end_date < date('now', 'localtime'), ch.end_date DESC, ch.id DESC`,
  );
}

export async function saveChallenge(
  db: SQLiteDatabase,
  c: { kind: ChallengeKind; category_id: number | null; amount: number | null; start_date: string; end_date: string },
) {
  await db.runAsync(
    'INSERT INTO challenges (kind, category_id, amount, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
    c.kind, c.category_id, c.amount, c.start_date, c.end_date,
  );
  notifyChange();
}

export async function removeChallenge(db: SQLiteDatabase, id: number) {
  await db.runAsync('UPDATE challenges SET active = 0 WHERE id = ?', id);
  notifyChange();
}

/**
 * Spending per day between two dates (inclusive), leaving out what recurring rules add
 * automatically (rent, subscriptions): challenges are about the spending you choose.
 */
export async function dailySpending(db: SQLiteDatabase, start: string, end: string, categoryId?: number | null) {
  const rows = await db.getAllAsync<{ date: string; total: number }>(
    `SELECT date, SUM(amount) AS total FROM transactions
     WHERE type = 'expense' AND recurring_id IS NULL AND date >= ? AND date <= ? ${categoryId ? 'AND category_id = ?' : ''}
     GROUP BY date`,
    ...(categoryId ? [start, end, categoryId] : [start, end]),
  );
  return Object.fromEntries(rows.map((r) => [r.date, r.total])) as Record<string, number>;
}

/** Days with chosen spending in the last year, for the no-spend streak. */
export async function spendDays(db: SQLiteDatabase, today = todayISO()) {
  const from = toISODate(addDays(fromISODate(today), -366));
  return new Set(Object.keys(await dailySpending(db, from, today)));
}

export type { AccountRow };
