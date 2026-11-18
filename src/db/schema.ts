import type { SQLiteDatabase } from 'expo-sqlite';
import type { IconName, TxType } from './types';

/** Category used for transfer and mobile-money fees. */
export const FEES_CATEGORY = 'Fees & Charges';

const DEFAULT_CATEGORIES: [string, TxType, IconName, string][] = [
  ['Food & Dining', 'expense', 'restaurant', '#F97316'],
  ['Groceries', 'expense', 'cart', '#22C55E'],
  ['Transport', 'expense', 'car', '#3B82F6'],
  ['Housing', 'expense', 'home', '#8B5CF6'],
  ['Utilities', 'expense', 'flash', '#EAB308'],
  ['Shopping', 'expense', 'bag-handle', '#EC4899'],
  ['Health', 'expense', 'medkit', '#EF4444'],
  ['Entertainment', 'expense', 'film', '#A855F7'],
  ['Education', 'expense', 'school', '#0EA5E9'],
  ['Subscriptions', 'expense', 'repeat', '#6366F1'],
  ['Travel', 'expense', 'airplane', '#14B8A6'],
  ['Personal Care', 'expense', 'sparkles', '#D946EF'],
  ['Gifts & Donations', 'expense', 'gift', '#F43F5E'],
  ['Debt Payments', 'expense', 'card', '#78716C'],
  ['Other', 'expense', 'ellipsis-horizontal', '#64748B'],
  ['Salary', 'income', 'briefcase', '#10B981'],
  ['Business', 'income', 'storefront', '#06B6D4'],
  ['Freelance', 'income', 'laptop', '#84CC16'],
  ['Investments', 'income', 'trending-up', '#F59E0B'],
  ['Gifts Received', 'income', 'gift', '#EC4899'],
  ['Other Income', 'income', 'cash', '#64748B'],
];

const LATEST_VERSION = 5;

/** Runs before the app renders (via SQLiteProvider onInit). */
export async function migrateDbIfNeeded(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  if (version >= LATEST_VERSION) return;

  if (version === 0) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE categories (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          icon TEXT NOT NULL,
          color TEXT NOT NULL,
          archived INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE transactions (
          id INTEGER PRIMARY KEY NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          amount INTEGER NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id),
          date TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE INDEX idx_transactions_date ON transactions(date);
        CREATE TABLE budgets (
          category_id INTEGER PRIMARY KEY NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
          amount INTEGER NOT NULL
        );
        CREATE TABLE goals (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          target INTEGER NOT NULL,
          saved INTEGER NOT NULL DEFAULT 0,
          deadline TEXT,
          color TEXT NOT NULL,
          icon TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE bills (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          amount INTEGER NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id),
          due_date TEXT NOT NULL,
          frequency TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE settings (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      for (const [name, type, icon, color] of DEFAULT_CATEGORIES) {
        await db.runAsync('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)', name, type, icon, color);
      }
    });
  }
  if (version < 2) {
    // Cache of official exchange rates (units of `currency` per 1 USD) so conversions work offline.
    await db.execAsync(`
      CREATE TABLE fx_rates (
        currency TEXT PRIMARY KEY NOT NULL,
        per_usd REAL NOT NULL,
        rate_date TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        source_url TEXT
      );
    `);
  }
  if (version < 3) {
    await db.withTransactionAsync(async () => {
      // Wallets: cash, bank and mobile money accounts. Existing transactions move into the first one.
      // (account_id has no REFERENCES clause: SQLite can't add one with ALTER TABLE while foreign keys are on.)
      await db.execAsync(`
        CREATE TABLE accounts (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          icon TEXT NOT NULL,
          color TEXT NOT NULL,
          opening_balance INTEGER NOT NULL DEFAULT 0,
          archived INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO accounts (id, name, kind, icon, color) VALUES (1, 'Main account', 'bank', 'wallet', '#0F766E');
        ALTER TABLE transactions ADD COLUMN account_id INTEGER;
        UPDATE transactions SET account_id = 1;
        ALTER TABLE transactions ADD COLUMN recurring_id INTEGER;
        CREATE INDEX idx_transactions_account ON transactions(account_id);

        CREATE TABLE transfers (
          id INTEGER PRIMARY KEY NOT NULL,
          from_account INTEGER NOT NULL REFERENCES accounts(id),
          to_account INTEGER NOT NULL REFERENCES accounts(id),
          amount INTEGER NOT NULL,
          fee_tx_id INTEGER,
          date TEXT NOT NULL,
          note TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE recurring (
          id INTEGER PRIMARY KEY NOT NULL,
          type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          amount INTEGER NOT NULL,
          category_id INTEGER NOT NULL REFERENCES categories(id),
          account_id INTEGER,
          note TEXT NOT NULL DEFAULT '',
          frequency TEXT NOT NULL,
          next_date TEXT NOT NULL,
          anchor_day INTEGER,
          active INTEGER NOT NULL DEFAULT 1
        );
      `);
      // Transfer and mobile-money fees get their own category.
      const fees = await db.getFirstAsync('SELECT id FROM categories WHERE name = ?', FEES_CATEGORY);
      if (!fees) {
        await db.runAsync('INSERT INTO categories (name, type, icon, color) VALUES (?, ?, ?, ?)', FEES_CATEGORY, 'expense', 'receipt', '#94A3B8');
      }
    });
  }
  if (version < 4) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        CREATE TABLE debts (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          balance INTEGER NOT NULL,
          apr REAL NOT NULL DEFAULT 0,
          min_payment INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        -- Rotating savings groups (ajo, esusu, susu, chama, stokvel). Contributions and payouts are
        -- transfers between the member's account and the group's own account (pot_account_id).
        CREATE TABLE savings_groups (
          id INTEGER PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          contribution INTEGER NOT NULL,
          frequency TEXT NOT NULL,
          start_date TEXT NOT NULL,
          members INTEGER NOT NULL,
          my_turn INTEGER NOT NULL,
          account_id INTEGER NOT NULL,
          pot_account_id INTEGER NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        ALTER TABLE transfers ADD COLUMN group_id INTEGER;
        ALTER TABLE transfers ADD COLUMN group_cycle INTEGER;
      `);
    });
  }
  if (version < 5) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        -- Accounts in another currency (e.g. a USD domiciliary account). NULL = the home currency.
        ALTER TABLE accounts ADD COLUMN currency TEXT;
        -- Transactions on such an account: amount stays in the home currency (converted at the official
        -- rate when recorded) so every total still adds up; orig_* keep what was actually paid.
        ALTER TABLE transactions ADD COLUMN orig_amount INTEGER;
        ALTER TABLE transactions ADD COLUMN orig_currency TEXT;
        -- Amount credited to the receiving account when it's in a different currency.
        ALTER TABLE transfers ADD COLUMN to_amount INTEGER;

        -- Money lent and borrowed between people, including shares of split bills.
        CREATE TABLE ious (
          id INTEGER PRIMARY KEY NOT NULL,
          person TEXT NOT NULL,
          direction TEXT NOT NULL CHECK (direction IN ('owed_to_me', 'i_owe')),
          amount INTEGER NOT NULL,
          repaid INTEGER NOT NULL DEFAULT 0,
          note TEXT NOT NULL DEFAULT '',
          date TEXT NOT NULL,
          due_date TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE challenges (
          id INTEGER PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('no_spend', 'category_cap', 'spend_cap')),
          category_id INTEGER,
          amount INTEGER,
          start_date TEXT NOT NULL,
          end_date TEXT NOT NULL,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        -- One row per calendar month, updated through the month, for the net worth chart.
        CREATE TABLE net_worth (
          month TEXT PRIMARY KEY NOT NULL,
          assets INTEGER NOT NULL,
          liabilities INTEGER NOT NULL,
          recorded_at TEXT NOT NULL
        );
      `);
    });
  }
  // Future migrations: `if (version < 6) { ... }`

  await db.execAsync(`PRAGMA user_version = ${LATEST_VERSION}`);
}
