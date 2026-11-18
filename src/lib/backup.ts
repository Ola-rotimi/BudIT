/**
 * Full-data backup and restore as a single JSON file the user saves wherever they like
 * (Files, Google Drive, email…). Nothing is uploaded by the app itself.
 *
 * With a password, the snapshot is encrypted (AES-256-GCM, see ./crypto) and only the envelope
 * below is readable: anyone who finds the file sees nothing about the user's finances.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { setSetting } from '@/db/queries';
import { exportSnapshot, SnapshotError, validateSnapshot, type Snapshot } from '@/db/snapshot';
import { decryptText, encryptText, type EncryptedPayload } from './crypto';
import { todayISO } from './dates';
import { tr } from '@/i18n';

export { importSnapshot as restoreBackup, SnapshotError as BackupError } from '@/db/snapshot';
export type BackupFile = Snapshot;

/** Settings key: ISO time of the last backup the user shared, for the "back up soon" reminder. */
export const LAST_BACKUP_KEY = 'lastBackupAt';
/** Remind the user to back up after this many days. */
export const BACKUP_REMINDER_DAYS = 30;

export type EncryptedEnvelope = { app: 'BudT'; format: 1; encrypted: true } & EncryptedPayload;

export type PickedBackup = { kind: 'plain'; snapshot: BackupFile } | { kind: 'encrypted'; envelope: EncryptedEnvelope };

/** Writes a backup (encrypted when a password is given) to the cache directory. */
export async function createBackupFile(db: SQLiteDatabase, password?: string) {
  const snapshot = JSON.stringify(await exportSnapshot(db));
  const body = password
    ? JSON.stringify({ app: 'BudT', format: 1, encrypted: true, ...(await encryptText(snapshot, password)) } satisfies EncryptedEnvelope)
    : snapshot;
  clearOldBackups();
  const file = new File(Paths.cache, `BudT-backup-${todayISO()}${password ? '-locked' : ''}.json`);
  file.create({ overwrite: true });
  await file.write(body);
  return file;
}

/** Opens the share sheet so the user can save the backup, and records when they last did. */
export async function shareBackupFile(db: SQLiteDatabase, file: File) {
  if (!(await Sharing.isAvailableAsync())) throw new SnapshotError(tr('Sharing isn’t available on this device.'));
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: tr('Save your BudT backup') });
  await setSetting(db, LAST_BACKUP_KEY, new Date().toISOString());
}

/**
 * Removes earlier backup copies from the cache so a readable copy of the user's data doesn't linger.
 * The latest one is kept until the next backup, since the app it was shared to may still be reading it.
 */
export function clearOldBackups() {
  try {
    for (const entry of new Directory(Paths.cache).list()) {
      if (entry instanceof File && entry.name.startsWith('BudT-backup-')) entry.delete();
    }
  } catch {
    // Best effort: the cache is cleared by the OS eventually anyway.
  }
}

/** Lets the user pick a backup file and checks it. Returns null if they cancel. */
export async function pickBackup(): Promise<PickedBackup | null> {
  // Android often reports JSON as application/octet-stream, so accept any file and validate the contents.
  const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  const file = new File(picked.assets[0].uri);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new SnapshotError(tr('That file isn’t a BudT backup.'));
  } finally {
    if (file.exists) file.delete();
  }
  if (isEncrypted(parsed)) return { kind: 'encrypted', envelope: parsed };
  return { kind: 'plain', snapshot: validateSnapshot(parsed) };
}

/** Decrypts a password-protected backup. Throws `WrongPasswordError` for a wrong password. */
export async function unlockBackup(envelope: EncryptedEnvelope, password: string): Promise<BackupFile> {
  const text = await decryptText(envelope, password);
  return validateSnapshot(JSON.parse(text));
}

function isEncrypted(value: unknown): value is EncryptedEnvelope {
  const v = value as Partial<EncryptedEnvelope> | null;
  return !!v && v.app === 'BudT' && v.encrypted === true && typeof v.data === 'string' && !!v.kdf && !!v.cipher;
}
