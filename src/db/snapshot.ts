/** Serialises the whole database to a plain object and restores it. Used by backup/restore. */
import type { SQLiteDatabase } from 'expo-sqlite';
import { notifyChange } from './events';
import { tr } from '@/i18n';

/**
 * 2 added accounts, transfers and recurring rules; 3 added debts and savings groups; 4 added
 * account currencies, IOUs, challenges and net worth history. Older backups still restore.
 */
export const SNAPSHOT_FORMAT = 4;

/** Columns copied for each table, in insert order (parents before children). */
const TABLES = {
  categories: ['id', 'name', 'type', 'icon', 'color', 'archived'],
  accounts: ['id', 'name', 'kind', 'icon', 'color', 'opening_balance', 'archived', 'currency', 'created_at'],
  transactions: ['id', 'type', 'amount', 'category_id', 'account_id', 'recurring_id', 'date', 'note', 'orig_amount', 'orig_currency', 'created_at'],
  budgets: ['category_id', 'amount'],
  goals: ['id', 'name', 'target', 'saved', 'deadline', 'color', 'icon', 'created_at'],
  bills: ['id', 'name', 'amount', 'category_id', 'due_date', 'frequency', 'active'],
  recurring: ['id', 'type', 'amount', 'category_id', 'account_id', 'note', 'frequency', 'next_date', 'anchor_day', 'active'],
  savings_groups: ['id', 'name', 'contribution', 'frequency', 'start_date', 'members', 'my_turn', 'account_id', 'pot_account_id', 'active', 'created_at'],
  transfers: ['id', 'from_account', 'to_account', 'amount', 'fee_tx_id', 'date', 'note', 'group_id', 'group_cycle', 'to_amount', 'created_at'],
  debts: ['id', 'name', 'balance', 'apr', 'min_payment', 'created_at'],
  ious: ['id', 'person', 'direction', 'amount', 'repaid', 'note', 'date', 'due_date', 'created_at'],
  challenges: ['id', 'kind', 'category_id', 'amount', 'start_date', 'end_date', 'active', 'created_at'],
  net_worth: ['month', 'assets', 'liabilities', 'recorded_at'],
  settings: ['key', 'value'],
} as const;

/** Tables each backup format introduced; older backups restore them as empty. */
const ADDED_IN: Partial<Record<TableName, number>> = {
  accounts: 2,
  recurring: 2,
  transfers: 2,
  savings_groups: 3,
  debts: 3,
  ious: 4,
  challenges: 4,
  net_worth: 4,
};

type TableName = keyof typeof TABLES;
type Row = Record<string, string | number | null>;

export type Snapshot = {
  /** File-format marker. Backups made under the earlier names ('BudT', 'BudiT') still restore. */
  app: 'BudIT' | 'BudiT' | 'BudT';
  format: number;
  exportedAt: string;
  tables: Record<TableName, Row[]>;
};

/** Every marker BudIT has written into backups. */
export const BACKUP_MARKERS: readonly string[] = ['BudIT', 'BudiT', 'BudT'];

export class SnapshotError extends Error {}

const entries = () => Object.entries(TABLES) as [TableName, readonly string[]][];

export async function exportSnapshot(db: SQLiteDatabase): Promise<Snapshot> {
  const tables = {} as Record<TableName, Row[]>;
  for (const [name, columns] of entries()) {
    tables[name] = await db.getAllAsync<Row>(`SELECT ${columns.join(', ')} FROM ${name}`);
  }
  return { app: 'BudIT', format: SNAPSHOT_FORMAT, exportedAt: new Date().toISOString(), tables };
}

/** Checks that parsed JSON is a BudIT snapshot this version can restore. */
export function validateSnapshot(parsed: unknown): Snapshot {
  const s = parsed as Partial<Snapshot> | null;
  if (!s || !BACKUP_MARKERS.includes(s.app as string) || typeof s.tables !== 'object' || !s.tables) throw new SnapshotError(tr('That file isn’t a BudIT backup.'));
  if ((s.format ?? 0) > SNAPSHOT_FORMAT) {
    throw new SnapshotError(tr('This backup was made by a newer version of BudIT. Update the app and try again.'));
  }
  const tables = { ...s.tables } as Record<TableName, Row[]>;
  for (const [name] of entries()) {
    if (tables[name] === undefined && (s.format ?? 1) < (ADDED_IN[name] ?? 0)) tables[name] = [];
    if (!Array.isArray(tables[name])) throw new SnapshotError(tr('This backup is incomplete or damaged.'));
  }
  return { ...s, tables } as Snapshot;
}

/** Replaces all app data with the snapshot's contents, atomically: on any error nothing changes. */
export async function importSnapshot(db: SQLiteDatabase, snapshot: Snapshot) {
  try {
    await db.withTransactionAsync(async () => {
      // Children first so foreign keys never point at missing rows.
      await db.execAsync(
        `DELETE FROM transfers; DELETE FROM savings_groups; DELETE FROM debts; DELETE FROM recurring; DELETE FROM budgets;
         DELETE FROM bills; DELETE FROM transactions; DELETE FROM goals; DELETE FROM ious; DELETE FROM challenges; DELETE FROM net_worth;
         DELETE FROM accounts; DELETE FROM categories; DELETE FROM settings;`,
      );
      for (const [name, columns] of entries()) {
        for (const row of snapshot.tables[name]) {
          // Omit missing values so column defaults apply; only known column names ever reach the SQL.
          const cols = columns.filter((c) => row[c] !== undefined && row[c] !== null);
          await db.runAsync(
            `INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
            cols.map((c) => row[c] as string | number),
          );
        }
      }
      // Format-1 backups predate accounts: give their transactions a default one.
      if (!(await db.getFirstAsync('SELECT id FROM accounts LIMIT 1'))) {
        await db.runAsync(`INSERT INTO accounts (id, name, kind, icon, color) VALUES (1, 'Main account', 'bank', 'wallet', '#0F766E')`);
      }
      await db.runAsync('UPDATE transactions SET account_id = (SELECT id FROM accounts ORDER BY archived, id LIMIT 1) WHERE account_id IS NULL');
    });
  } catch {
    throw new SnapshotError(tr('This backup is damaged and couldn’t be restored. Your existing data hasn’t been changed.'));
  }
  notifyChange();
}
