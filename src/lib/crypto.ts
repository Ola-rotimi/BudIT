/**
 * Password-based encryption for backup files, and PIN hashing for the app lock.
 *
 * Uses audited pure-JS primitives (@noble) so a backup made on any phone decrypts identically on
 * any other: AES-256-GCM with a key derived from the password by PBKDF2-HMAC-SHA256.
 * Random bytes come from the platform's secure generator via expo-crypto.
 */
import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, bytesToUtf8, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';

/** Work factor for backup passwords. Stored in each file so it can be raised later. */
const BACKUP_ITERATIONS = 150_000;
/** PINs are only ever checked on-device against a hardware-protected hash, so fewer rounds suffice. */
const PIN_ITERATIONS = 5_000;

export type EncryptedPayload = {
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; nonce: string };
  /** Ciphertext with the 16-byte GCM tag appended, hex-encoded. */
  data: string;
};

export class WrongPasswordError extends Error {
  constructor() {
    super('That password is incorrect.');
  }
}

const deriveKey = (password: string, salt: Uint8Array, iterations: number) =>
  pbkdf2Async(sha256, utf8ToBytes(password.normalize('NFKC')), salt, { c: iterations, dkLen: 32 });

export async function encryptText(plaintext: string, password: string, iterations = BACKUP_ITERATIONS): Promise<EncryptedPayload> {
  const salt = getRandomBytes(16);
  const nonce = getRandomBytes(12);
  const key = await deriveKey(password, salt, iterations);
  const data = gcm(key, nonce).encrypt(utf8ToBytes(plaintext));
  return {
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: bytesToHex(salt) },
    cipher: { name: 'AES-256-GCM', nonce: bytesToHex(nonce) },
    data: bytesToHex(data),
  };
}

/** Throws `WrongPasswordError` if the password is wrong or the file was altered (GCM authentication fails). */
export async function decryptText(payload: EncryptedPayload, password: string): Promise<string> {
  if (payload.kdf?.name !== 'PBKDF2-SHA256' || payload.cipher?.name !== 'AES-256-GCM') throw new Error('Unsupported encryption');
  const key = await deriveKey(password, hexToBytes(payload.kdf.salt), payload.kdf.iterations);
  try {
    return bytesToUtf8(gcm(key, hexToBytes(payload.cipher.nonce)).decrypt(hexToBytes(payload.data)));
  } catch {
    throw new WrongPasswordError();
  }
}

export type PinHash = { salt: string; hash: string; iterations: number };

export async function hashPin(pin: string): Promise<PinHash> {
  const salt = getRandomBytes(16);
  const hash = await pbkdf2Async(sha256, utf8ToBytes(pin), salt, { c: PIN_ITERATIONS, dkLen: 32 });
  return { salt: bytesToHex(salt), hash: bytesToHex(hash), iterations: PIN_ITERATIONS };
}

export async function verifyPin(pin: string, stored: PinHash): Promise<boolean> {
  const hash = await pbkdf2Async(sha256, utf8ToBytes(pin), hexToBytes(stored.salt), { c: stored.iterations, dkLen: 32 });
  return constantTimeEqual(bytesToHex(hash), stored.hash);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** A random 256-bit key as hex, e.g. for the database. */
export const randomKeyHex = () => bytesToHex(getRandomBytes(32));
