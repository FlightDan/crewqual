import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getServerConfig } from "@/server/config";

export function createOpaqueToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function createTotpSecret(byteLength = 20) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = randomBytes(byteLength);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function settingsEncryptionKey() {
  const config = getServerConfig();
  const material = config.SETTINGS_ENCRYPTION_KEY || config.SESSION_SECRET;
  if (!material) throw new Error("SETTINGS_ENCRYPTION_KEY is required");
  return createHash("sha256").update(material).digest();
}

export function encryptSettingSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", settingsEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSettingSecret(value: string) {
  const [version, ivValue, tagValue, ciphertextValue] = value.split(":");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Invalid encrypted setting secret");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    settingsEncryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function resolveTotpSecret(ciphertext: string) {
  return decryptSettingSecret(ciphertext);
}

export function sha256(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.replace(/=+$/, "").replace(/\s/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

/**
 * Verify a TOTP code and return the accepted time-step counter.
 * Returning the counter lets callers atomically reject replayed codes.
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code) || !secret) return null;
  const key = decodeBase32(secret);
  const counter = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) {
    const matchedCounter = counter + offset;
    if (matchedCounter < 0) continue;
    const buffer = Buffer.alloc(8);
    buffer.writeBigUInt64BE(BigInt(matchedCounter));
    const digest = createHmac("sha1", key).update(buffer).digest();
    const start = digest[digest.length - 1] & 0x0f;
    const value = (digest.readUInt32BE(start) & 0x7fffffff) % 1_000_000;
    if (value.toString().padStart(6, "0") === code) return matchedCounter;
  }
  return null;
}
