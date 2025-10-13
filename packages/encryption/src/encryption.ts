import { Effect, Context, Layer } from "effect";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { DecryptionError, EncryptionError } from "./errors";
import type { EncryptedData } from "./types";

export interface EncryptionService {
  readonly encrypt: (text: string) => Effect.Effect<EncryptedData, EncryptionError>
  readonly decrypt: (data: EncryptedData) => Effect.Effect<string, DecryptionError>
  readonly encryptJson: (obj: Record<string, any>) => Effect.Effect<EncryptedData, EncryptionError>
  readonly decryptJson: (data: EncryptedData) => Effect.Effect<Record<string, any>, DecryptionError>
}

export const EncryptionService = Context.GenericTag<EncryptionService>(
  "EncryptionService"
);

const makeEncryptionService = Effect.gen(function* () {
  const algorithm = "aes-256-gcm";

  const key = yield* Effect.sync(() => {
    const masterKey = process.env.ENCRYPTION_MASTER_KEY;

    if (!masterKey) {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "⚠️ No ENCRYPTION_MASTER_KEY found, generating a temporary key for development"
        );
        const tempKey = randomBytes(32);
        console.log(`Generated key (hex): ${tempKey.toString("hex")}`);
        return tempKey;
      } else {
        throw new EncryptionError(
          "ENCRYPTION_MASTER_KEY is required in production"
        );
      }
    } else if (masterKey.length !== 64) {
      throw new EncryptionError(
        "ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes)"
      );
    } else {
      return Buffer.from(masterKey, "hex");
    }
  }).pipe(
    Effect.catchAll((error) =>
      Effect.fail(
        new EncryptionError("Failed to initialize encryption key", error)
      )
    )
  );

  const encrypt = (text: string): Effect.Effect<EncryptedData, EncryptionError> =>
    Effect.try({
      try: () => {
        const iv = randomBytes(16);
        const cipher = createCipheriv(algorithm, key, iv);

        let encrypted = cipher.update(text, "utf8", "hex");
        encrypted += cipher.final("hex");

        const tag = cipher.getAuthTag();

        return {
          encrypted,
          iv: iv.toString("hex"),
          tag: tag.toString("hex"),
        };
      },
      catch: (error) => new EncryptionError("Failed to encrypt text", error),
    });

  const decrypt = (data: EncryptedData): Effect.Effect<string, DecryptionError> =>
    Effect.try({
      try: () => {
        const decipher = createDecipheriv(algorithm, key, Buffer.from(data.iv, "hex"));

        decipher.setAuthTag(Buffer.from(data.tag, "hex"));

        let decrypted = decipher.update(data.encrypted, "hex", "utf8");
        decrypted += decipher.final("utf8");

        return decrypted;
      },
      catch: (error) => new DecryptionError("Failed to decrypt data", error),
    });

  const encryptJson = (obj: Record<string, any>): Effect.Effect<EncryptedData, EncryptionError> =>
    Effect.try({
      try: () => JSON.stringify(obj),
      catch: (error) => new EncryptionError("Failed to stringify JSON", error),
    }).pipe(Effect.flatMap(encrypt));

  const decryptJson = (data: EncryptedData): Effect.Effect<Record<string, any>, DecryptionError> =>
    decrypt(data).pipe(
      Effect.flatMap((text) =>
        Effect.try({
          try: () => JSON.parse(text) as Record<string, any>,
          catch: (error) =>
            new DecryptionError("Failed to parse decrypted JSON", error),
        })
      )
    );

  return EncryptionService.of({
    encrypt,
    decrypt,
    encryptJson,
    decryptJson,
  });
});

export const EncryptionServiceLive = Layer.effect(
  EncryptionService,
  makeEncryptionService
);
