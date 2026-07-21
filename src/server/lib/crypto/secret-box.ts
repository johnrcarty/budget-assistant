import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const keyBase64 = process.env.SIMPLEFIN_ENCRYPTION_KEY;
  if (!keyBase64) {
    throw new Error("SIMPLEFIN_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) {
    throw new Error("SIMPLEFIN_ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptSecret(plaintext: string): {
  ciphertext: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(encrypted: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}
