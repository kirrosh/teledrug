import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import type { EncryptedData } from "../types";

const ALGORITHM = "aes-256-gcm";

export const resolveKey = (): Buffer => {
  const masterKey = process.env.ENCRYPTION_MASTER_KEY;

  if (!masterKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "⚠️ No ENCRYPTION_MASTER_KEY found, generating a temporary key for development"
      );
      const tempKey = randomBytes(32);
      console.log(`Generated key (hex): ${tempKey.toString("hex")}`);
      return tempKey;
    }

    throw new Error("ENCRYPTION_MASTER_KEY is required in production");
  }

  if (masterKey.length !== 64) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes)"
    );
  }

  return Buffer.from(masterKey, "hex");
};

export const encryptWithKey = (key: Buffer, text: string): EncryptedData => {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const tag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
  };
};

export const decryptWithKey = (key: Buffer, data: EncryptedData): string => {
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(data.iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(data.tag, "hex"));

  let decrypted = decipher.update(data.encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
};
