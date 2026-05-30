import { createHash, createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";

const APP_SALT = "com.usenocturne.Nocturne.encryption.v1";
const ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(userID: string): Buffer {
  const salt = Buffer.from(APP_SALT + userID, "utf-8");
  const password = Buffer.from(userID, "utf-8");
  return pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, "sha256");
}

export function encrypt(plaintext: string, userID: string): string {
  const key = deriveKey(userID);
  const nonce = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf-8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([nonce, encrypted, tag]);
  return combined.toString("base64");
}

export function decrypt(ciphertext: string, userID: string): string {
  const key = deriveKey(userID);
  const combined = Buffer.from(ciphertext, "base64");

  if (combined.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("Invalid encrypted data format");
  }

  const nonce = combined.subarray(0, IV_LENGTH);
  const tag = combined.subarray(combined.length - TAG_LENGTH);
  const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf-8");
}
