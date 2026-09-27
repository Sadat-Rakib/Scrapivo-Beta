/**
 * AES-256-GCM credential encryption at rest (Workstream 6).
 *
 * Key: SCRAPIVO_NOTIFICATIONS_KEY — exactly 32 bytes, hex or base64 encoded.
 * Fail-closed: if the env var is unset/invalid, saving a connection REFUSES
 * with a clear error (we never derive the key from another secret, never fall
 * back to a zero key, and never persist plaintext credentials). Decryption of
 * an existing row with a changed key fails loudly instead of returning garbage.
 *
 * Wire format: base64( 12-byte IV || 16-byte GCM tag || ciphertext ).
 * Plaintext is never logged anywhere in this module.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCMTypes,
} from "node:crypto";

const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer | null {
  const raw = process.env.SCRAPIVO_NOTIFICATIONS_KEY;
  if (!raw) return null;
  const trimmed = raw.trim();
  let key: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, "hex");
  } else {
    try {
      const decoded = Buffer.from(trimmed, "base64");
      key = decoded.length === 32 ? decoded : null;
    } catch {
      key = null;
    }
  }
  return key && key.length === 32 ? key : null;
}

export function notificationsKeyConfigured(): boolean {
  return loadKey() !== null;
}

export class NotificationsKeyError extends Error {
  constructor() {
    super(
      "Notification credentials cannot be saved: SCRAPIVO_NOTIFICATIONS_KEY is not set to a valid 32-byte hex/base64 key",
    );
    this.name = "NotificationsKeyError";
  }
}

export function encryptCredentials(value: unknown): string {
  const key = loadKey();
  if (!key) throw new NotificationsKeyError();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm" as CipherGCMTypes, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(value), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

/** Throws on tampered rows, wrong keys, or malformed payloads — never returns partial data. */
export function decryptCredentials<T = Record<string, unknown>>(blob: string): T {
  const key = loadKey();
  if (!key) throw new NotificationsKeyError();
  const raw = Buffer.from(blob, "base64");
  if (raw.length <= IV_BYTES + TAG_BYTES) {
    throw new Error("[notifications crypto] malformed encrypted payload");
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm" as CipherGCMTypes, key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plain.toString("utf8")) as T;
}
