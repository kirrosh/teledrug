import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import {
  EncryptionService,
  EncryptionServiceLive,
  CryptographyService,
  CryptographyServiceLive,
  CryptographyError,
  EncryptionError,
  DecryptionError,
} from "../src";

const withEnv = async <T>(
  key: string,
  value: string | undefined,
  fn: () => Promise<T>
): Promise<T> => {
  const prev = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    if (prev === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = prev;
    }
  }
};

describe("@teledrug/encryption", () => {
  const validKey = "a".repeat(64);
  const withTestConfig = <T>(
    key: string | undefined,
    fn: () => Promise<T>
  ) => withEnv("NODE_ENV", "test", () => withEnv("ENCRYPTION_MASTER_KEY", key, fn));

  describe("EncryptionService", () => {
    it("encrypts and decrypts text symmetrically", async () => {
      const result = await withTestConfig(validKey, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* EncryptionService;
            const encrypted = yield* service.encrypt("Secret message");
            const decrypted = yield* service.decrypt(encrypted);
            return { encrypted, decrypted };
          }).pipe(Effect.provide(EncryptionServiceLive))
        )
      );

      expect(result.encrypted.encrypted).not.toBe("Secret message");
      expect(result.decrypted).toBe("Secret message");
    });

    it("encrypts and decrypts JSON payloads", async () => {
      const payload = { id: 1, name: "TeleDrug" };

      const result = await withTestConfig(validKey, () =>
        Effect.runPromise(
          Effect.gen(function* () {
            const service = yield* EncryptionService;
            const encrypted = yield* service.encryptJson(payload);
            const decrypted = yield* service.decryptJson(encrypted);
            return { encrypted, decrypted };
          }).pipe(Effect.provide(EncryptionServiceLive))
        )
      );

      expect(result.decrypted).toEqual(payload);
      expect(result.encrypted.iv).toHaveLength(32);
      expect(result.encrypted.tag).toHaveLength(32);
    });

    it("fails when master key has invalid length", async () => {
      await withTestConfig("abc", async () => {
        await expect(
          Effect.runPromise(
            Effect.gen(function* () {
              yield* EncryptionService;
            }).pipe(Effect.provide(EncryptionServiceLive))
          )
        ).rejects.toThrow(/ENCRYPTION_MASTER_KEY must be exactly 64 hex characters/);
      });
    });
  });

  describe("CryptographyService", () => {
    const withService = <A>(
      effect: Effect.Effect<A, CryptographyError>
    ): Promise<A> =>
      withTestConfig(validKey, () =>
        Effect.runPromise(effect.pipe(Effect.provide(CryptographyServiceLive)))
      );

    it("encrypts and decrypts plain text", async () => {
      const encrypted = await withService(
        Effect.gen(function* () {
          const service = yield* CryptographyService;
          return yield* service.encrypt("Hello");
        })
      );

      expect(encrypted.encrypted).not.toBe("Hello");

      const decrypted = await withService(
        Effect.gen(function* () {
          const service = yield* CryptographyService;
          return yield* service.decrypt(
            encrypted.encrypted,
            encrypted.iv,
            encrypted.tag
          );
        })
      );

      expect(decrypted).toBe("Hello");
    });

    it("encrypts and decrypts JSON objects", async () => {
      const payload = { modules: ["calendar", "tasks"] };

      const encrypted = await withService(
        Effect.gen(function* () {
          const service = yield* CryptographyService;
          return yield* service.encryptJson(payload);
        })
      );

      const decrypted = await withService(
        Effect.gen(function* () {
          const service = yield* CryptographyService;
          return yield* service.decryptJson(
            encrypted.encrypted,
            encrypted.iv,
            encrypted.tag
          );
        })
      );

      expect(decrypted).toEqual(payload);
    });

    it("fails when decrypting with wrong tag", async () => {
      const encrypted = await withService(
        Effect.gen(function* () {
          const service = yield* CryptographyService;
          return yield* service.encrypt("Hello");
        })
      );

      await expect(
        withService(
          Effect.gen(function* () {
            const service = yield* CryptographyService;
            return yield* service.decrypt(
              encrypted.encrypted,
              encrypted.iv,
              "0".repeat(32)
            );
          })
        )
      ).rejects.toThrow(/Failed to decrypt data/);
    });
  });
});
