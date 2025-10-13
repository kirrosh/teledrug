import { Effect, Context, Layer } from "effect";
import { CryptographyError } from "./errors";
import type { EncryptedData } from "./types";
import { decryptWithKey, encryptWithKey, resolveKey } from "./internal/aes";

export interface CryptographyService {
  readonly encrypt: (
    text: string
  ) => Effect.Effect<EncryptedData, CryptographyError>;
  readonly decrypt: (
    encrypted: string,
    iv: string,
    tag: string
  ) => Effect.Effect<string, CryptographyError>;
  readonly encryptJson: (
    obj: Record<string, any>
  ) => Effect.Effect<EncryptedData, CryptographyError>;
  readonly decryptJson: (
    encrypted: string,
    iv: string,
    tag: string
  ) => Effect.Effect<Record<string, any>, CryptographyError>;
}

export const CryptographyService = Context.GenericTag<CryptographyService>(
  "@services/CryptographyService"
);

const makeCryptographyService = Effect.gen(function* () {
  const key = yield* Effect.try({
    try: resolveKey,
    catch: (error) =>
      new CryptographyError({
        message: "Failed to initialize encryption key",
        cause: error,
      }),
  });

  const encrypt = (text: string): Effect.Effect<EncryptedData, CryptographyError> =>
    Effect.try({
      try: () => encryptWithKey(key, text),
      catch: (cause) =>
        new CryptographyError({
          message: "Failed to encrypt data",
          cause,
        }),
    });

  const decrypt = (
    encrypted: string,
    iv: string,
    tag: string
  ): Effect.Effect<string, CryptographyError> =>
    Effect.try({
      try: () =>
        decryptWithKey(key, {
          encrypted,
          iv,
          tag,
        }),
      catch: (cause) =>
        new CryptographyError({
          message: "Failed to decrypt data",
          cause,
        }),
    });

  const encryptJson = (
    obj: Record<string, any>
  ): Effect.Effect<EncryptedData, CryptographyError> =>
    Effect.try({
      try: () => encryptWithKey(key, JSON.stringify(obj)),
      catch: (cause) =>
        new CryptographyError({
          message: "Failed to serialize and encrypt JSON",
          cause,
        }),
    });

  const decryptJson = (
    encrypted: string,
    iv: string,
    tag: string
  ): Effect.Effect<Record<string, any>, CryptographyError> =>
    decrypt(encrypted, iv, tag).pipe(
      Effect.flatMap((decryptedString) =>
        Effect.try({
          try: () => JSON.parse(decryptedString) as Record<string, any>,
          catch: (cause) =>
            new CryptographyError({
              message: "Failed to decrypt and parse JSON",
              cause,
            }),
        })
      )
    );

  return CryptographyService.of({
    encrypt,
    decrypt,
    encryptJson,
    decryptJson,
  });
});

export const CryptographyServiceLive = Layer.effect(
  CryptographyService,
  makeCryptographyService
);
