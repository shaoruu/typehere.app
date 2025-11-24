import CryptoJS from "crypto-js";
import crypto from "crypto";

export function generateSalt(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function deriveKey(password: string, salt: string): string {
  return CryptoJS.PBKDF2(password, salt, {
    keySize: 256 / 32,
    iterations: 10000,
  }).toString();
}

export function encrypt(data: string, key: string): string {
  return CryptoJS.AES.encrypt(data, key).toString();
}

export function decrypt(encrypted: string, key: string): string {
  const decrypted = CryptoJS.AES.decrypt(encrypted, key);
  return decrypted.toString(CryptoJS.enc.Utf8);
}

export function hashPasswordForStorage(password: string): string {
  return CryptoJS.SHA256(password).toString();
}

export function hashNoteId(noteId: string): string {
  return CryptoJS.SHA256(noteId).toString().slice(0, 12);
}
