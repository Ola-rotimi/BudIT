import type { SQLiteDatabase } from 'expo-sqlite';
import { advanceDate, periodKeyOf, periodRange, shiftMonth, todayISO } from '@/lib/dates';
import { notifyChange } from './events';
import { FEES_CATEGORY } from './schema';
import type { Account, Bill, Budget, Category, Debt, Goal, IconName, Recurring, SavingsGroup, Transaction, Transfer, TxType } from './types';

/** `[start, end)` date bounds for a budget period key (a calendar month, or payday to payday). */
const monthRange = periodRange;

// ---------- Settings ----------

export async function getSetting(db: SQLiteDatabase, key: string) {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setSetting(db: SQLiteDatabase, key: string, value: string) {
  await db.runAsync('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  notifyChange();
}

// ---------- Categories ----------

export function listCategories(db: SQLiteDatabase, type?: TxType) {
  return type
    ? db.getAllAsync<Category>('SELECT * FROM categories WHERE archived = 0 AND type = ? ORDER BY name', type)
    : db.getAllAsync<Category>('SELECT * FROM categories WHERE archived = 0 ORDER BY type DESC, name');
}

export function getCategory(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Category>('SELECT * FROM categories WHERE id = ?', id);
}

export async function saveCategory(db: SQLiteDatabase, c: Omit<Category, 'id' | 'archived'> & { id?: number }) {
  if (c.id) {
    await db.runAsync('UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?', c.name, c.icon, c.color, c.id);
  } else {
    await db.runAsync('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)', c.name, c.type, c.icon, c.color);
  }
  notifyChange();
}

/** Categories are archived rather than deleted so past transactions keep their label. */
export async function archiveCategory(db: SQLiteDatabase, id: number) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE categories SET archived = 1 WHERE id = ?', id);
    await db.runAsync('DELETE FROM budgets WHERE category_id = ?', id);
  });
  notifyChange();
}

// ---------- Transactions ----------

export type TxRow = Transaction & { category_name: string; category_icon: IconName; category_color: string; account_name: string | null };

const TX_SELECT = `
  SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, a.name AS account_name
  FROM transactions t JOIN categories c ON c.id = t.category_id LEFT JOIN accounts a ON a.id = t.account_id`;

export function listTransactions(db: SQLiteDatabase, month: string, type?: TxType, search = '', accountId?: number) {
  const [start, end] = monthRange(month);
  const where = ['t.date >= ?', 't.date < ?'];
  const params: (string | number)[] = [start, end];
  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (search.trim()) {
    where.push('(t.note LIKE ? OR c.name LIKE ?)');
    const like = `%${search.trim()}%`;
    params.push(like, like);
  }
  return db.getAllAsync<TxRow>(`${TX_SELECT} WHERE ${where.join(' AND ')} ORDER BY t.date DESC, t.id DESC`, params);
}

export async function transactionCount(db: SQLiteDatabase) {
  return (await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM transactions'))?.n ?? 0;
}

export function recentTransactions(db: SQLiteDatabase, limit = 5) {
  return db.getAllAsync<TxRow>(`${TX_SELECT} ORDER BY t.date DESC, t.id DESC LIMIT ?`, limit);
}

export function getTransaction(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Transaction>('SELECT * FROM transactions WHERE id = ?', id);
}

export type TxInput = Pick<Transaction, 'type' | 'amount' | 'category_id' | 'date' | 'note'> & { id?: number; account_id?: number | null };

/** Saves a transaction and returns its id. */
export async function saveTransaction(db: SQLiteDatabase, tx: TxInput) {
  const accountId = tx.account_id ?? (await defaultAccountId(db));
  let id = tx.id;
  if (id) {
    await db.runAsync(
      'UPDATE transactions SET type = ?, amount = ?, category_id = ?, account_id = ?, date = ?, note = ? WHERE id = ?',
      tx.type, tx.amount, tx.category_id, accountId, tx.date, tx.note, id,
    );
  } else {
    const res = await db.runAsync(
      'INSERT INTO transactions (type, amount, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?)',
      tx.type, tx.amount, tx.category_id, accountId, tx.date, tx.note,
    );
    id = res.lastInsertRowId;
  }
  notifyChange();
  return id;
}

export async function deleteTransaction(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', id);
  notifyChange();
}

// ---------- Aggregates ----------

export type Totals = { income: number; expense: number };

const TOTALS_SQL = `
  SELECT COALESCE(SUM(CASE WHEN type = 'income' THEN amount END), 0) AS income,
         COALESCE(SUM(CASE WHEN type = 'expense' THEN amount END), 0) AS expense
  FROM transactions`;

export async function monthTotals(db: SQLiteDatabase, month: string): Promise<Totals> {
  const row = await db.getFirstAsync<Totals>(`${TOTALS_SQL} WHERE date >= ? AND date < ?`, monthRange(month));
  return row ?? { income: 0, expense: 0 };
}

export async function allTimeTotals(db: SQLiteDatabase): Promise<Totals> {
  const row = await db.getFirstAsync<Totals>(TOTALS_SQL);
  return row ?? { income: 0, expense: 0 };
}

/** Income/expense per budget period for the `count` periods ending at `endMonth`, oldest first. */
export async function monthlyTotals(db: SQLiteDatabase, endMonth: string, count: number) {
  const startMonth = shiftMonth(endMonth, -(count - 1));
  const months = Array.from({ length: count }, (_, i) => shiftMonth(startMonth, i));
  // One query per period, since periods may run payday to payday rather than by calendar month.
  return Promise.all(months.map(async (month) => ({ month, ...(await monthTotals(db, month)) })));
}

export type CategoryTotal = { id: number; name: string; icon: IconName; color: string; total: number; count: number };

export function categoryTotals(db: SQLiteDatabase, month: string, type: TxType) {
  const [start, end] = monthRange(month);
  return db.getAllAsync<CategoryTotal>(
    `SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = ? AND t.date >= ? AND t.date < ?
     GROUP BY c.id ORDER BY total DESC`,
    type, start, end,
  );
}

// ---------- Accounts (wallets) ----------

export type AccountRow = Account & { balance: number };

const BALANCE_SQL = `
  a.opening_balance
  + COALESCE((SELECT SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE -t.amount END) FROM transactions t WHERE t.account_id = a.id), 0)
  - COALESCE((SELECT SUM(x.amount) FROM transfers x WHERE x.from_account = a.id), 0)
  + COALESCE((SELECT SUM(x.amount) FROM transfers x WHERE x.to_account = a.id), 0)`;

export function listAccounts(db: SQLiteDatabase, includeArchived = false) {
  return db.getAllAsync<AccountRow>(
    `SELECT a.*, ${BALANCE_SQL} AS balance FROM accounts a ${includeArchived ? '' : 'WHERE a.archived = 0'} ORDER BY a.archived, a.id`,
  );
}

export function getAccount(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<AccountRow>(`SELECT a.*, ${BALANCE_SQL} AS balance FROM accounts a WHERE a.id = ?`, id);
}

/** The account new transactions go to when none is chosen: the oldest active one. */
export async function defaultAccountId(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM accounts WHERE archived = 0 ORDER BY id LIMIT 1');
  return row?.id ?? null;
}

export async function saveAccount(db: SQLiteDatabase, a: Pick<Account, 'name' | 'kind' | 'icon' | 'color' | 'opening_balance'> & { id?: number }) {
  if (a.id) {
    await db.runAsync(
      'UPDATE accounts SET name = ?, kind = ?, icon = ?, color = ?, opening_balance = ? WHERE id = ?',
      a.name, a.kind, a.icon, a.color, a.opening_balance, a.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO accounts (name, kind, icon, color, opening_balance) VALUES (?, ?, ?, ?, ?)',
      a.name, a.kind, a.icon, a.color, a.opening_balance,
    );
  }
  notifyChange();
}

/**
 * Removes an account: deleted outright if nothing uses it, otherwise archived so past records keep it.
 * Returns false if it's the last active account (there must always be one).
 */
export async function removeAccount(db: SQLiteDatabase, id: number) {
  const active = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM accounts WHERE archived = 0 AND id != ?', id);
  if (!active?.n) return false;
  const used = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT count(*) FROM transactions WHERE account_id = ?) + (SELECT count(*) FROM transfers WHERE from_account = ? OR to_account = ?)
            + (SELECT count(*) FROM recurring WHERE account_id = ?) AS n`,
    id, id, id, id,
  );
  if (used?.n) await db.runAsync('UPDATE accounts SET archived = 1 WHERE id = ?', id);
  else await db.runAsync('DELETE FROM accounts WHERE id = ?', id);
  notifyChange();
  return true;
}

// ---------- Statement import ----------

export type ImportRow = { date: string; amount: number; type: TxType; note: string; category_id: number };

/** True for each row that already exists in the account (same date, amount and direction). */
export async function findDuplicates(db: SQLiteDatabase, accountId: number, rows: Pick<ImportRow, 'date' | 'amount' | 'type'>[]) {
  if (!rows.length) return [];
  const dates = rows.map((r) => r.date).sort();
  const existing = await db.getAllAsync<{ date: string; amount: number; type: string }>(
    'SELECT date, amount, type FROM transactions WHERE account_id = ? AND date >= ? AND date <= ?',
    accountId, dates[0], dates[dates.length - 1],
  );
  const seen = new Map<string, number>();
  for (const e of existing) seen.set(`${e.date}|${e.amount}|${e.type}`, (seen.get(`${e.date}|${e.amount}|${e.type}`) ?? 0) + 1);
  // Count-based, so two genuinely identical purchases on one day are only matched against two existing ones.
  return rows.map((r) => {
    const key = `${r.date}|${r.amount}|${r.type}`;
    const left = seen.get(key) ?? 0;
    if (left > 0) seen.set(key, left - 1);
    return left > 0;
  });
}

/** Adds imported statement lines to an account in one transaction. */
export async function importTransactions(db: SQLiteDatabase, accountId: number, rows: ImportRow[]) {
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(
        'INSERT INTO transactions (type, amount, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?)',
        r.type, r.amount, r.category_id, accountId, r.date, r.note,
      );
    }
  });
  notifyChange();
}

// ---------- Transfers ----------

export type TransferRow = Transfer & { from_name: string; to_name: string; fee: number };

const TRANSFER_SELECT = `
  SELECT x.*, f.name AS from_name, d.name AS to_name, COALESCE(t.amount, 0) AS fee
  FROM transfers x JOIN accounts f ON f.id = x.from_account JOIN accounts d ON d.id = x.to_account
  LEFT JOIN transactions t ON t.id = x.fee_tx_id`;

export function listTransfers(db: SQLiteDatabase, month: string, accountId?: number) {
  const [start, end] = monthRange(month);
  return db.getAllAsync<TransferRow>(
    `${TRANSFER_SELECT} WHERE x.date >= ? AND x.date < ? ${accountId ? 'AND (x.from_account = ? OR x.to_account = ?)' : ''}
     ORDER BY x.date DESC, x.id DESC`,
    accountId ? [start, end, accountId, accountId] : [start, end],
  );
}

export function getTransfer(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<TransferRow>(`${TRANSFER_SELECT} WHERE x.id = ?`, id);
}

async function feesCategoryId(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ id: number }>('SELECT id FROM categories WHERE name = ? AND type = ?', FEES_CATEGORY, 'expense');
  if (row) {
    await db.runAsync('UPDATE categories SET archived = 0 WHERE id = ?', row.id);
    return row.id;
  }
  const res = await db.runAsync('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)', FEES_CATEGORY, 'expense', 'receipt', '#94A3B8');
  return res.lastInsertRowId;
}

/**
 * Moves money between accounts. A fee (e.g. a mobile-money charge) is recorded as an expense from
 * the sending account so it shows up in spending. Editing replaces the old transfer and fee.
 */
export async function saveTransfer(
  db: SQLiteDatabase,
  x: { id?: number; from_account: number; to_account: number; amount: number; fee: number; date: string; note: string },
) {
  await db.withTransactionAsync(async () => {
    if (x.id) await removeTransfer(db, x.id);
    let feeTxId: number | null = null;
    if (x.fee > 0) {
      const res = await db.runAsync(
        'INSERT INTO transactions (type, amount, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?)',
        'expense', x.fee, await feesCategoryId(db), x.from_account, x.date, x.note ? `Transfer fee: ${x.note}` : 'Transfer fee',
      );
      feeTxId = res.lastInsertRowId;
    }
    await db.runAsync(
      'INSERT INTO transfers (from_account, to_account, amount, fee_tx_id, date, note) VALUES (?, ?, ?, ?, ?, ?)',
      x.from_account, x.to_account, x.amount, feeTxId, x.date, x.note,
    );
  });
  notifyChange();
}

async function removeTransfer(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ fee_tx_id: number | null }>('SELECT fee_tx_id FROM transfers WHERE id = ?', id);
  await db.runAsync('DELETE FROM transfers WHERE id = ?', id);
  if (row?.fee_tx_id) await db.runAsync('DELETE FROM transactions WHERE id = ?', row.fee_tx_id);
}

export async function deleteTransfer(db: SQLiteDatabase, id: number) {
  await db.withTransactionAsync(() => removeTransfer(db, id));
  notifyChange();
}

// ---------- Debts ----------

export function listDebts(db: SQLiteDatabase) {
  return db.getAllAsync<Debt>('SELECT * FROM debts WHERE balance > 0 ORDER BY apr DESC, balance');
}

export function getDebt(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Debt>('SELECT * FROM debts WHERE id = ?', id);
}

export async function saveDebt(db: SQLiteDatabase, d: Pick<Debt, 'name' | 'balance' | 'apr' | 'min_payment'> & { id?: number }) {
  if (d.id) {
    await db.runAsync('UPDATE debts SET name = ?, balance = ?, apr = ?, min_payment = ? WHERE id = ?', d.name, d.balance, d.apr, d.min_payment, d.id);
  } else {
    await db.runAsync('INSERT INTO debts (name, balance, apr, min_payment) VALUES (?, ?, ?, ?)', d.name, d.balance, d.apr, d.min_payment);
  }
  notifyChange();
}

export async function deleteDebt(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM debts WHERE id = ?', id);
  notifyChange();
}

// ---------- Savings groups (ajo, esusu, susu, chama, stokvel) ----------

export type GroupRow = SavingsGroup & { pot_balance: number; paid_cycles: number; received: number };

const GROUP_SELECT = `
  SELECT g.*,
    COALESCE((SELECT SUM(CASE WHEN x.to_account = g.pot_account_id THEN x.amount ELSE -x.amount END)
              FROM transfers x WHERE x.group_id = g.id), 0) AS pot_balance,
    (SELECT count(*) FROM transfers x WHERE x.group_id = g.id AND x.to_account = g.pot_account_id) AS paid_cycles,
    COALESCE((SELECT SUM(x.amount) FROM transfers x WHERE x.group_id = g.id AND x.from_account = g.pot_account_id), 0) AS received
  FROM savings_groups g`;

export function listGroups(db: SQLiteDatabase) {
  return db.getAllAsync<GroupRow>(`${GROUP_SELECT} WHERE g.active = 1 ORDER BY g.created_at`);
}

export function getGroup(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<GroupRow>(`${GROUP_SELECT} WHERE g.id = ?`, id);
}

export function groupTransfers(db: SQLiteDatabase, groupId: number) {
  return db.getAllAsync<Transfer>('SELECT * FROM transfers WHERE group_id = ? ORDER BY group_cycle, id', groupId);
}

/** Creates a group and the account that tracks its money. */
export async function createGroup(
  db: SQLiteDatabase,
  g: Pick<SavingsGroup, 'name' | 'contribution' | 'frequency' | 'start_date' | 'members' | 'my_turn' | 'account_id'>,
) {
  await db.withTransactionAsync(async () => {
    const pot = await db.runAsync(
      'INSERT INTO accounts (name, kind, icon, color, opening_balance) VALUES (?, ?, ?, ?, 0)',
      `${g.name} (group savings)`, 'savings', 'people', '#D97706',
    );
    await db.runAsync(
      `INSERT INTO savings_groups (name, contribution, frequency, start_date, members, my_turn, account_id, pot_account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      g.name, g.contribution, g.frequency, g.start_date, g.members, g.my_turn, g.account_id, pot.lastInsertRowId,
    );
  });
  notifyChange();
}

/** Records this user's contribution for a cycle (account → group) or their payout (group → account). */
export async function recordGroupMove(db: SQLiteDatabase, g: SavingsGroup, kind: 'contribution' | 'payout', cycle: number, date: string) {
  const payout = kind === 'payout';
  await db.runAsync(
    'INSERT INTO transfers (from_account, to_account, amount, date, note, group_id, group_cycle) VALUES (?, ?, ?, ?, ?, ?, ?)',
    payout ? g.pot_account_id : g.account_id,
    payout ? g.account_id : g.pot_account_id,
    payout ? g.contribution * g.members : g.contribution,
    date,
    payout ? `${g.name}: payout` : `${g.name}: contribution ${cycle}`,
    g.id,
    cycle,
  );
  notifyChange();
}

export async function undoGroupMove(db: SQLiteDatabase, transferId: number) {
  await db.runAsync('DELETE FROM transfers WHERE id = ? AND group_id IS NOT NULL', transferId);
  notifyChange();
}

/** Ends a group. Its history stays; the tracking account is archived. */
export async function endGroup(db: SQLiteDatabase, g: SavingsGroup) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE savings_groups SET active = 0 WHERE id = ?', g.id);
    await db.runAsync('UPDATE accounts SET archived = 1 WHERE id = ?', g.pot_account_id);
  });
  notifyChange();
}

// ---------- Recurring transactions ----------

export type RecurringRow = Recurring & { category_name: string; category_icon: IconName; category_color: string; account_name: string | null };

export function listRecurring(db: SQLiteDatabase) {
  return db.getAllAsync<RecurringRow>(
    `SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, a.name AS account_name
     FROM recurring r JOIN categories c ON c.id = r.category_id LEFT JOIN accounts a ON a.id = r.account_id
     WHERE r.active = 1 ORDER BY r.next_date`,
  );
}

export function getRecurring(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Recurring>('SELECT * FROM recurring WHERE id = ?', id);
}

export async function saveRecurring(db: SQLiteDatabase, r: Omit<Recurring, 'id' | 'active' | 'anchor_day'> & { id?: number }) {
  const anchorDay = Number(r.next_date.slice(8, 10));
  if (r.id) {
    await db.runAsync(
      'UPDATE recurring SET type = ?, amount = ?, category_id = ?, account_id = ?, note = ?, frequency = ?, next_date = ?, anchor_day = ? WHERE id = ?',
      r.type, r.amount, r.category_id, r.account_id, r.note, r.frequency, r.next_date, anchorDay, r.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO recurring (type, amount, category_id, account_id, note, frequency, next_date, anchor_day) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      r.type, r.amount, r.category_id, r.account_id, r.note, r.frequency, r.next_date, anchorDay,
    );
  }
  notifyChange();
}

/** Stops a rule. Transactions it already added are kept. */
export async function stopRecurring(db: SQLiteDatabase, id: number) {
  await db.runAsync('UPDATE recurring SET active = 0 WHERE id = ?', id);
  notifyChange();
}

/** Most entries one rule may add in a single catch-up (e.g. after months without opening the app). */
const MAX_CATCH_UP = 60;

/**
 * Adds every transaction that recurring rules have due up to `today`, then moves each rule on.
 * Safe to call often: each date is only ever added once because the rule's next date advances in
 * the same database transaction. Returns how many transactions were added.
 */
export async function processRecurring(db: SQLiteDatabase, today = todayISO()) {
  const due = await db.getAllAsync<Recurring>('SELECT * FROM recurring WHERE active = 1 AND next_date <= ?', today);
  if (!due.length) return 0;
  let added = 0;
  await db.withTransactionAsync(async () => {
    for (const r of due) {
      let next = r.next_date;
      for (let i = 0; next <= today && i < MAX_CATCH_UP; i++) {
        await db.runAsync(
          'INSERT INTO transactions (type, amount, category_id, account_id, date, note, recurring_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          r.type, r.amount, r.category_id, r.account_id ?? (await defaultAccountId(db)), next, r.note, r.id,
        );
        added++;
        next = advanceDate(next, r.frequency, r.anchor_day ?? undefined);
      }
      // If the catch-up limit was hit, skip ahead rather than leaving the rule stuck in the past.
      while (next <= today) next = advanceDate(next, r.frequency, r.anchor_day ?? undefined);
      await db.runAsync('UPDATE recurring SET next_date = ? WHERE id = ?', next, r.id);
    }
  });
  notifyChange();
  return added;
}

/** Category totals between two dates (`[start, end)`), e.g. for a tax year. */
export function categoryTotalsBetween(db: SQLiteDatabase, start: string, end: string, type: TxType) {
  return db.getAllAsync<CategoryTotal>(
    `SELECT c.id, c.name, c.icon, c.color, SUM(t.amount) AS total, COUNT(*) AS count
     FROM transactions t JOIN categories c ON c.id = t.category_id
     WHERE t.type = ? AND t.date >= ? AND t.date < ?
     GROUP BY c.id ORDER BY total DESC`,
    type, start, end,
  );
}

// ---------- Budgets ----------

export type BudgetRow = { category_id: number; name: string; icon: IconName; color: string; budget: number; spent: number };

export function budgetsWithSpending(db: SQLiteDatabase, month: string) {
  const [start, end] = monthRange(month);
  return db.getAllAsync<BudgetRow>(
    `SELECT c.id AS category_id, c.name, c.icon, c.color, b.amount AS budget,
            COALESCE((SELECT SUM(t.amount) FROM transactions t
                      WHERE t.category_id = c.id AND t.type = 'expense' AND t.date >= ? AND t.date < ?), 0) AS spent
     FROM budgets b JOIN categories c ON c.id = b.category_id
     WHERE c.archived = 0
     ORDER BY c.name`,
    start, end,
  );
}

/**
 * After an expense is saved: if it took its category past 80% or 100% of the budget for that
 * period, returns a short warning. Null otherwise (no budget, or no threshold crossed).
 */
export async function budgetWarning(db: SQLiteDatabase, categoryId: number, date: string, amount: number) {
  const budget = await getBudget(db, categoryId);
  if (!budget?.amount) return null;
  const [start, end] = monthRange(periodKeyOf(date));
  const row = await db.getFirstAsync<{ spent: number; name: string }>(
    `SELECT COALESCE(SUM(t.amount), 0) AS spent, c.name FROM categories c
     LEFT JOIN transactions t ON t.category_id = c.id AND t.type = 'expense' AND t.date >= ? AND t.date < ?
     WHERE c.id = ?`,
    start, end, categoryId,
  );
  if (!row) return null;
  const after = row.spent / budget.amount;
  const before = (row.spent - amount) / budget.amount;
  if (before < 1 && after >= 1) return { level: 'over' as const, name: row.name, ratio: after };
  if (before < 0.8 && after >= 0.8) return { level: 'near' as const, name: row.name, ratio: after };
  return null;
}

export function getBudget(db: SQLiteDatabase, categoryId: number) {
  return db.getFirstAsync<Budget>('SELECT * FROM budgets WHERE category_id = ?', categoryId);
}

export async function setBudget(db: SQLiteDatabase, categoryId: number, amount: number) {
  await db.runAsync(
    'INSERT INTO budgets (category_id, amount) VALUES (?, ?) ON CONFLICT(category_id) DO UPDATE SET amount = excluded.amount',
    categoryId, amount,
  );
  notifyChange();
}

export async function deleteBudget(db: SQLiteDatabase, categoryId: number) {
  await db.runAsync('DELETE FROM budgets WHERE category_id = ?', categoryId);
  notifyChange();
}

export const EMERGENCY_GOAL = 'Emergency fund';

/**
 * Saves a smart-budget plan: replaces every budget with the plan's, and optionally creates
 * (or retargets) the emergency fund goal. All or nothing.
 */
export async function applyBudgetPlan(db: SQLiteDatabase, budgets: Budget[], emergencyTarget?: number) {
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM budgets');
    for (const b of budgets) {
      await db.runAsync('INSERT INTO budgets (category_id, amount) VALUES (?, ?)', b.category_id, b.amount);
    }
    if (emergencyTarget) {
      const goal = await db.getFirstAsync<{ id: number }>('SELECT id FROM goals WHERE name = ?', EMERGENCY_GOAL);
      if (goal) await db.runAsync('UPDATE goals SET target = ? WHERE id = ?', emergencyTarget, goal.id);
      else {
        await db.runAsync(
          'INSERT INTO goals (name, target, saved, deadline, color, icon) VALUES (?, ?, 0, NULL, ?, ?)',
          EMERGENCY_GOAL, emergencyTarget, '#10B981', 'shield-checkmark',
        );
      }
    }
  });
  notifyChange();
}

// ---------- Goals ----------

export function listGoals(db: SQLiteDatabase) {
  return db.getAllAsync<Goal>('SELECT * FROM goals ORDER BY (saved >= target), deadline IS NULL, deadline, created_at');
}

export function getGoal(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Goal>('SELECT * FROM goals WHERE id = ?', id);
}

export async function saveGoal(db: SQLiteDatabase, g: Omit<Goal, 'id' | 'created_at'> & { id?: number }) {
  if (g.id) {
    await db.runAsync(
      'UPDATE goals SET name = ?, target = ?, saved = ?, deadline = ?, color = ?, icon = ? WHERE id = ?',
      g.name, g.target, g.saved, g.deadline, g.color, g.icon, g.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO goals (name, target, saved, deadline, color, icon) VALUES (?, ?, ?, ?, ?, ?)',
      g.name, g.target, g.saved, g.deadline, g.color, g.icon,
    );
  }
  notifyChange();
}

/** Adds (or, with a negative delta, withdraws) money from a goal. Never goes below zero. */
export async function contributeToGoal(db: SQLiteDatabase, id: number, delta: number) {
  await db.runAsync('UPDATE goals SET saved = MAX(0, saved + ?) WHERE id = ?', delta, id);
  notifyChange();
}

export async function deleteGoal(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM goals WHERE id = ?', id);
  notifyChange();
}

// ---------- Bills ----------

export type BillRow = Bill & { category_name: string; category_icon: IconName; category_color: string };

export function listBills(db: SQLiteDatabase) {
  return db.getAllAsync<BillRow>(
    `SELECT b.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color
     FROM bills b JOIN categories c ON c.id = b.category_id
     WHERE b.active = 1 ORDER BY b.due_date, b.name`,
  );
}

export function getBill(db: SQLiteDatabase, id: number) {
  return db.getFirstAsync<Bill>('SELECT * FROM bills WHERE id = ?', id);
}

export async function saveBill(db: SQLiteDatabase, b: Omit<Bill, 'id' | 'active'> & { id?: number }) {
  if (b.id) {
    await db.runAsync(
      'UPDATE bills SET name = ?, amount = ?, category_id = ?, due_date = ?, frequency = ? WHERE id = ?',
      b.name, b.amount, b.category_id, b.due_date, b.frequency, b.id,
    );
  } else {
    await db.runAsync(
      'INSERT INTO bills (name, amount, category_id, due_date, frequency) VALUES (?, ?, ?, ?, ?)',
      b.name, b.amount, b.category_id, b.due_date, b.frequency,
    );
  }
  notifyChange();
}

export async function deleteBill(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM bills WHERE id = ?', id);
  notifyChange();
}

/** Records the payment as an expense today and moves the bill to its next due date. */
export async function markBillPaid(db: SQLiteDatabase, bill: Bill, accountId?: number) {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO transactions (type, amount, category_id, account_id, date, note) VALUES (?, ?, ?, ?, ?, ?)',
      'expense', bill.amount, bill.category_id, accountId ?? (await defaultAccountId(db)), todayISO(), bill.name,
    );
    if (bill.frequency === 'once') {
      await db.runAsync('UPDATE bills SET active = 0 WHERE id = ?', bill.id);
    } else {
      await db.runAsync('UPDATE bills SET due_date = ? WHERE id = ?', advanceDate(bill.due_date, bill.frequency), bill.id);
    }
  });
  notifyChange();
}

// ---------- Data management ----------

export async function exportTransactionsCsv(db: SQLiteDatabase) {
  const rows = await db.getAllAsync<TxRow>(`${TX_SELECT} ORDER BY t.date, t.id`);
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = rows.map((r) => [r.date, r.type, esc(r.category_name), (r.amount / 100).toFixed(2), esc(r.note)].join(','));
  return { csv: ['Date,Type,Category,Amount,Note', ...lines].join('\n'), count: rows.length };
}

export async function resetAllData(db: SQLiteDatabase) {
  await db.withTransactionAsync(async () => {
    // Accounts are kept (they're set-up, like categories) but their opening balances are cleared.
    await db.execAsync(`
      DELETE FROM transfers; DELETE FROM savings_groups; DELETE FROM debts; DELETE FROM recurring; DELETE FROM transactions;
      DELETE FROM budgets; DELETE FROM goals; DELETE FROM bills;
      UPDATE accounts SET opening_balance = 0;
    `);
  });
  notifyChange();
}
