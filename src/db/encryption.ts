/**
 * Database encryption at rest with SQLCipher (enabled by `useSQLCipher` in app.json).
 *
 * The 256-bit key is random and lives only in the device keychain/keystore. Builds without
 * SQLCipher (Expo Go) keep the original unencrypted database. An existing unencrypted database is
 * copied into an encrypted one, checked row for row, and only then deleted, so a failure at any
 * step leaves the user's data where it was.
 */
import { File } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import { defaultDatabaseDirectory, deleteDatabaseAsync, openDatabaseAsync, openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';
import { randomKeyHex } from '@/lib/crypto';

/** The unencrypted database. Still used where SQLCipher isn't available (e.g. Expo Go). */
export const PLAIN_DB = 'budit-plain.db';
export const SECURE_DB = 'budit.db';
const MIGRATING_DB = 'budit-migrating.db';

const KEY_NAME = 'budit.dbKey';
/** Names used before the app was renamed BudIT; moved over once on first launch. */
const LEGACY_FILES: [from: string, to: string][] = [
  ['fintrack.db', PLAIN_DB],
  ['budt.db', SECURE_DB],
];
const LEGACY_KEY_NAME = 'budt.dbKey';
// Not "this device only": on iOS the key then travels with an encrypted device backup, like the database.
const KEY_OPTS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK };

export type PreparedDatabase = {
  name: string;
  /** Hex key for `PRAGMA key`, or null for an unencrypted database. */
  key: string | null;
  /** Set when an encrypted database couldn't be opened (its key was lost) and was set aside. */
  unreadable?: boolean;
};

const pathOf = (name: string) => `${String(defaultDatabaseDirectory).replace(/\/+$/, '')}/${name}`;
const fileOf = (name: string) => new File(`file://${pathOf(name)}`);

/** Must be the first statement on a connection to an encrypted database. The key is generated hex, never user input. */
export const keyStatement = (key: string) => `PRAGMA key = "x'${key}'"`;

function hasSQLCipher() {
  try {
    const db = openDatabaseSync(':memory:');
    const row = db.getFirstSync<{ cipher_version?: string }>('PRAGMA cipher_version');
    db.closeSync();
    return !!row?.cipher_version;
  } catch {
    return false;
  }
}

async function getOrCreateKey() {
  const existing = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  // The key from before the rename, if any: keep using it so the existing database still opens.
  const legacy = await SecureStore.getItemAsync(LEGACY_KEY_NAME, KEY_OPTS);
  if (legacy && /^[0-9a-f]{64}$/.test(legacy)) {
    await SecureStore.setItemAsync(KEY_NAME, legacy, KEY_OPTS);
    await SecureStore.deleteItemAsync(LEGACY_KEY_NAME, KEY_OPTS);
    return legacy;
  }
  const key = randomKeyHex();
  await SecureStore.setItemAsync(KEY_NAME, key, KEY_OPTS);
  return key;
}

/** Row counts of every user table, to check a copy is complete. */
async function fingerprint(db: SQLiteDatabase, schema = 'main') {
  const tables = await db.getAllAsync<{ name: string }>(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' ORDER BY name`);
  const counts: string[] = [];
  for (const { name } of tables) {
    const row = await db.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${schema}."${name.replace(/"/g, '""')}"`);
    counts.push(`${name}:${row?.n ?? 0}`);
  }
  return counts.join(',');
}

async function canOpen(name: string, key: string) {
  let db: SQLiteDatabase | null = null;
  try {
    db = await openDatabaseAsync(name);
    await db.execAsync(keyStatement(key));
    await db.getFirstAsync('SELECT count(*) FROM sqlite_master');
    return true;
  } catch {
    return false;
  } finally {
    await db?.closeAsync().catch(() => {});
  }
}

/** Copies the unencrypted database into an encrypted one with `sqlcipher_export`, verifies it, then swaps it in. */
async function encryptExisting(key: string) {
  if (fileOf(MIGRATING_DB).exists) await deleteDatabaseAsync(MIGRATING_DB);
  const plain = await openDatabaseAsync(PLAIN_DB);
  let expected: string;
  try {
    const version = (await plain.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    await plain.execAsync(`ATTACH DATABASE '${pathOf(MIGRATING_DB).replace(/'/g, "''")}' AS enc KEY "x'${key}'"`);
    await plain.execAsync(`SELECT sqlcipher_export('enc')`);
    await plain.execAsync(`PRAGMA enc.user_version = ${Number(version)}`);
    expected = await fingerprint(plain, 'main');
    const copied = await fingerprint(plain, 'enc');
    await plain.execAsync('DETACH DATABASE enc');
    if (copied !== expected) throw new Error('Encrypted copy is incomplete');
  } finally {
    await plain.closeAsync();
  }

  // Re-open the copy on its own with the key, to be sure it decrypts.
  const check = await openDatabaseAsync(MIGRATING_DB);
  try {
    await check.execAsync(keyStatement(key));
    if ((await fingerprint(check)) !== expected) throw new Error('Encrypted copy failed verification');
  } finally {
    await check.closeAsync();
  }

  fileOf(MIGRATING_DB).rename(SECURE_DB);
  await deleteDatabaseAsync(PLAIN_DB);
}

/** Moves databases saved under the old app names to the current ones (with their journal files). */
function moveLegacyFiles() {
  for (const [from, to] of LEGACY_FILES) {
    if (!fileOf(from).exists || fileOf(to).exists) continue;
    for (const suffix of ['', '-wal', '-shm']) {
      const f = fileOf(from + suffix);
      if (f.exists) f.rename(to + suffix);
    }
  }
}

/** Decides which database file to open, encrypting the existing one on first run with SQLCipher. */
export async function prepareDatabase(): Promise<PreparedDatabase> {
  try {
    moveLegacyFiles();
  } catch (e) {
    console.warn('Couldn’t move the database to its new name', e);
  }
  if (!hasSQLCipher()) return { name: PLAIN_DB, key: null };

  let key: string;
  try {
    key = await getOrCreateKey();
  } catch (e) {
    console.warn('Keystore unavailable; database stays unencrypted', e);
    return { name: PLAIN_DB, key: null };
  }

  let unreadable = false;
  if (fileOf(SECURE_DB).exists) {
    if (await canOpen(SECURE_DB, key)) {
      // A leftover plain file means a previous migration finished but couldn't delete it.
      if (fileOf(PLAIN_DB).exists) await deleteDatabaseAsync(PLAIN_DB).catch(() => {});
      return { name: SECURE_DB, key };
    }
    // The key is gone (e.g. restored onto a new phone without the keychain). Keep the file, start afresh.
    // Its journal files move with it so the new database can't pick them up.
    const aside = `budit-unreadable-${Date.now()}.db`;
    for (const suffix of ['', '-wal', '-shm']) {
      const f = fileOf(SECURE_DB + suffix);
      if (f.exists) f.rename(aside + suffix);
    }
    unreadable = true;
  }

  if (fileOf(PLAIN_DB).exists) {
    try {
      await encryptExisting(key);
    } catch (e) {
      console.warn('Database encryption failed; using the unencrypted database', e);
      if (fileOf(MIGRATING_DB).exists) await deleteDatabaseAsync(MIGRATING_DB).catch(() => {});
      return { name: PLAIN_DB, key: null };
    }
  }
  return { name: SECURE_DB, key, unreadable };
}
