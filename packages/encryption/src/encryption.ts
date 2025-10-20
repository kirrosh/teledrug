import { Effect, Context, Layer } from "effect";
import { DecryptionError, EncryptionError } from "./errors";
import type { EncryptedData } from "./types";
import { decryptWithKey, encryptWithKey, resolveKey } from "./internal/aes";

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
  const key = yield* Effect.try({
    try: resolveKey,
    catch: (error) =>
      new EncryptionError("Failed to initialize encryption key", error),
  });

  const encrypt = (text: string): Effect.Effect<EncryptedData, EncryptionError> =>
    Effect.try({
      try: () => encryptWithKey(key, text),
      catch: (error) => new EncryptionError("Failed to encrypt text", error),
    });

  const decrypt = (data: EncryptedData): Effect.Effect<string, DecryptionError> =>
    Effect.try({
      try: () => decryptWithKey(key, data),
      catch: (error) => new DecryptionError("Failed to decrypt data", error),
    });

  const encryptJson = (obj: Record<string, any>): Effect.Effect<EncryptedData, EncryptionError> =>
    Effect.try({
      try: () => encryptWithKey(key, JSON.stringify(obj)),
      catch: (error) => new EncryptionError("Failed to stringify JSON", error),
    });

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
