import { Effect, Context, Layer } from "effect"
import { randomBytes, createCipheriv, createDecipheriv } from "crypto"
import { CryptographyError } from "../errors"
import type { EncryptedData } from "../types"

// Service interface
export interface CryptographyService {
  readonly encrypt: (text: string) => Effect.Effect<EncryptedData, CryptographyError>
  readonly decrypt: (encrypted: string, iv: string, tag: string) => Effect.Effect<string, CryptographyError>
  readonly encryptJson: (obj: Record<string, any>) => Effect.Effect<EncryptedData, CryptographyError>
  readonly decryptJson: (encrypted: string, iv: string, tag: string) => Effect.Effect<Record<string, any>, CryptographyError>
}

// Service tag
export const CryptographyService = Context.GenericTag<CryptographyService>("@services/CryptographyService")

// Implementation
const makeCryptographyService = Effect.gen(function* () {
  const algorithm = "aes-256-gcm"

  // Get encryption key from environment
  const masterKey = process.env.ENCRYPTION_MASTER_KEY

  let key: Buffer
  if (!masterKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("⚠️ No ENCRYPTION_MASTER_KEY found, generating a temporary key for development")
      key = randomBytes(32)
      console.log(`Generated key (hex): ${key.toString("hex")}`)
    } else {
      return yield* Effect.fail(new CryptographyError({
        message: "ENCRYPTION_MASTER_KEY is required in production"
      }))
    }
  } else if (masterKey.length !== 64) {
    return yield* Effect.fail(new CryptographyError({
      message: "ENCRYPTION_MASTER_KEY must be exactly 64 hex characters (32 bytes)"
    }))
  } else {
    key = Buffer.from(masterKey, "hex")
  }

  const encrypt = (text: string): Effect.Effect<EncryptedData, CryptographyError> =>
    Effect.gen(function* () {
      try {
        const iv = randomBytes(16)
        const cipher = createCipheriv(algorithm, key, iv)

        let encrypted = cipher.update(text, "utf8", "hex")
        encrypted += cipher.final("hex")

        const tag = cipher.getAuthTag()

        return {
          encrypted,
          iv: iv.toString("hex"),
          tag: tag.toString("hex"),
        }
      } catch (cause) {
        return yield* Effect.fail(new CryptographyError({
          message: "Failed to encrypt data",
          cause
        }))
      }
    })

  const decrypt = (encrypted: string, iv: string, tag: string): Effect.Effect<string, CryptographyError> =>
    Effect.gen(function* () {
      try {
        const decipher = createDecipheriv(algorithm, key, Buffer.from(iv, "hex"))
        decipher.setAuthTag(Buffer.from(tag, "hex"))

        let decrypted = decipher.update(encrypted, "hex", "utf8")
        decrypted += decipher.final("utf8")

        return decrypted
      } catch (cause) {
        return yield* Effect.fail(new CryptographyError({
          message: "Failed to decrypt data",
          cause
        }))
      }
    })

  const encryptJson = (obj: Record<string, any>): Effect.Effect<EncryptedData, CryptographyError> =>
    Effect.gen(function* () {
      try {
        const jsonString = JSON.stringify(obj)
        return yield* encrypt(jsonString)
      } catch (cause) {
        return yield* Effect.fail(new CryptographyError({
          message: "Failed to serialize and encrypt JSON",
          cause
        }))
      }
    })

  const decryptJson = (encrypted: string, iv: string, tag: string): Effect.Effect<Record<string, any>, CryptographyError> =>
    Effect.gen(function* () {
      try {
        const decryptedString = yield* decrypt(encrypted, iv, tag)
        const parsed = JSON.parse(decryptedString)
        return parsed
      } catch (cause) {
        return yield* Effect.fail(new CryptographyError({
          message: "Failed to decrypt and parse JSON",
          cause
        }))
      }
    })

  return CryptographyService.of({
    encrypt,
    decrypt,
    encryptJson,
    decryptJson,
  })
})

// Live layer
export const CryptographyServiceLive = Layer.effect(
  CryptographyService,
  makeCryptographyService
)