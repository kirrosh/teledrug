import { Effect, Context, Layer, Option } from "effect"
import { eq, and } from "drizzle-orm"
import { db, users, userIntegrations, userSettings } from "@teledrug/db"
import { DigestSettingsRepository } from "./digest-settings"
import { EncryptionService, type EncryptedData } from "@teledrug/encryption"
import {
  type User,
  type NewUser,
  type UserIntegration,
  type UserSettings,
} from "../schemas/database"

export class DatabaseError {
  readonly _tag = "DatabaseError"
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export class UserNotFoundError {
  readonly _tag = "UserNotFoundError"
  constructor(readonly telegramId: number) {}
}

export class IntegrationNotFoundError {
  readonly _tag = "IntegrationNotFoundError"
  constructor(readonly userId: number, readonly integrationType: string) {}
}

export interface UserRepository {
  readonly createUser: (user: NewUser) => Effect.Effect<User, DatabaseError>
  readonly getUser: (telegramId: number) => Effect.Effect<Option.Option<User>, DatabaseError>
  readonly getOrCreateUser: (telegramId: number, username?: string) => Effect.Effect<User, DatabaseError>
  readonly getUserSettings: (
    userId: number
  ) => Effect.Effect<UserSettings, DatabaseError>
  readonly updateUserSettings: (
    userId: number,
    patch: Partial<{
      readonly timezone: string
      readonly locale: string
      readonly city: string | null
      readonly country: string | null
      readonly preferences: Record<string, any> | null
    }>
  ) => Effect.Effect<UserSettings, DatabaseError>
  readonly addIntegration: (
    userId: number,
    integrationType: string,
    credentials: Record<string, any>,
    settings?: Record<string, any>
  ) => Effect.Effect<UserIntegration, DatabaseError>
  readonly getIntegration: (
    userId: number,
    integrationType: string
  ) => Effect.Effect<Option.Option<UserIntegration>, DatabaseError>
  readonly getUserIntegrations: (userId: number) => Effect.Effect<UserIntegration[], DatabaseError>
  readonly getDecryptedIntegration: (
    userId: number,
    integrationType: string
  ) => Effect.Effect<Option.Option<{ integration: UserIntegration; credentials: Record<string, any> }>, DatabaseError>
  readonly getAllDecryptedIntegrations: (
    userId: number
  ) => Effect.Effect<Array<{ integration: UserIntegration; credentials: Record<string, any> }>, DatabaseError>
  readonly removeIntegration: (userId: number, integrationType: string) => Effect.Effect<void, DatabaseError>
  readonly toggleIntegration: (userId: number, integrationType: string, enabled: boolean) => Effect.Effect<void, DatabaseError>
}

export const UserRepository = Context.GenericTag<UserRepository>("UserRepository")

const makeUserRepository = Effect.gen(function* () {
  const encryption = yield* EncryptionService;
  const digestSettings = yield* DigestSettingsRepository;

  const DEFAULT_USER_SETTINGS = {
    timezone: "UTC" as const,
    locale: "ru-RU" as const,
  }

  const ensureUserSettings = (
    userId: number
  ): Effect.Effect<UserSettings, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        const [existing] = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, userId))
          .limit(1)

        if (existing) {
          return existing
        }

        await db.insert(userSettings).values({
          userId,
          timezone: DEFAULT_USER_SETTINGS.timezone,
          locale: DEFAULT_USER_SETTINGS.locale,
        })

        const [created] = await db
          .select()
          .from(userSettings)
          .where(eq(userSettings.userId, userId))
          .limit(1)

        if (!created) {
          throw new Error("Failed to create user settings")
        }

        return created
      },
      catch: (error) => new DatabaseError("Failed to ensure user settings", error),
    }).pipe(
      Effect.flatMap((settings) =>
        Effect.try({
          try: () => settings as UserSettings,
          catch: (error) =>
            new DatabaseError(
              "Invalid user settings data returned from database",
              error
            ),
        })
      )
    )

  const getUserSettings: UserRepository["getUserSettings"] = (userId) =>
    ensureUserSettings(userId)

  const updateUserSettings: UserRepository["updateUserSettings"] = (
    userId,
    patch
  ) =>
    ensureUserSettings(userId).pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: async () => {
            const updatePayload: Record<string, unknown> = {
              updatedAt: new Date(),
            }

            if (patch.timezone !== undefined) {
              updatePayload.timezone = patch.timezone
            }

            if (patch.locale !== undefined) {
              updatePayload.locale = patch.locale
            }

            if (patch.city !== undefined) {
              updatePayload.city = patch.city
            }

            if (patch.country !== undefined) {
              updatePayload.country = patch.country
            }

            if (patch.preferences !== undefined) {
              updatePayload.preferences = patch.preferences
            }

            const [updated] = await db
              .update(userSettings)
              .set(updatePayload)
              .where(eq(userSettings.userId, userId))
              .returning()

            if (!updated) {
              throw new Error("Failed to update user settings")
            }

            return updated
          },
          catch: (error) =>
            new DatabaseError("Failed to update user settings", error),
        })
      ),
      Effect.flatMap((settings) =>
        Effect.try({
          try: () => settings as UserSettings,
          catch: (error) =>
            new DatabaseError(
              "Invalid user settings data returned from database",
              error
            ),
        })
      )
    )

  const createUser = (user: NewUser): Effect.Effect<User, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        const [newUser] = await db.insert(users).values(user).returning()
        if (!newUser) {
          throw new Error('Failed to create user')
        }
        return newUser
      },
      catch: (error) => new DatabaseError('Failed to create user', error)
    }).pipe(
      Effect.flatMap(user =>
        Effect.try({
          try: () => user as User,
          catch: (error) => new DatabaseError('Invalid user data returned from database', error)
        })
      ),
      Effect.tap((createdUser) =>
        Effect.all(
          [
            ensureUserSettings(createdUser.telegramId),
            digestSettings.ensureDefaultSettings(createdUser.telegramId),
          ],
          { discard: true }
        ).pipe(Effect.catchAll(() => Effect.void))
      )
    )

  const getUser = (telegramId: number): Effect.Effect<Option.Option<User>, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId))
        return user || null
      },
      catch: (error) => new DatabaseError('Failed to get user', error)
    }).pipe(
      Effect.flatMap(user => {
        if (user === null) {
          return Effect.succeed(Option.none())
        }
        return Effect.try({
          try: () => Option.some(user as User),
          catch: (error) => new DatabaseError('Invalid user data from database', error)
        })
      })
    )

  const getOrCreateUser = (telegramId: number, username?: string): Effect.Effect<User, DatabaseError> =>
    getUser(telegramId).pipe(
      Effect.flatMap(userOption => {
        if (Option.isSome(userOption)) {
          const user = userOption.value
          // Update username if changed
          const ensureDefaults = Effect.all(
            [
              ensureUserSettings(user.telegramId),
              digestSettings.ensureDefaultSettings(user.telegramId),
            ],
            { discard: true }
          ).pipe(Effect.catchAll(() => Effect.void))

          if (username && user.username !== username) {
            return Effect.tryPromise({
              try: async () => {
                const [updated] = await db.update(users)
                  .set({ username, updatedAt: new Date() })
                  .where(eq(users.telegramId, telegramId))
                  .returning()
                if (!updated) {
                  throw new Error('Failed to update user')
                }
                return updated
              },
              catch: (error) => new DatabaseError('Failed to update user', error)
            }).pipe(
              Effect.flatMap(user =>
                Effect.try({
                  try: () => user as User,
                  catch: (error) => new DatabaseError('Invalid user data returned from database', error)
                })
              ),
              Effect.tap((updated) => ensureDefaults)
            )
          } else {
            return Effect.succeed(user).pipe(
              Effect.tap(() => ensureDefaults)
            )
          }
        } else {
          return createUser({ telegramId, username })
        }
      })
    )

  const addIntegration = (
    userId: number,
    integrationType: string,
    credentials: Record<string, any>,
    settings?: Record<string, any>
  ): Effect.Effect<UserIntegration, DatabaseError> =>
    encryption.encryptJson(credentials).pipe(
      Effect.flatMap(encrypted =>
        getIntegration(userId, integrationType).pipe(
          Effect.flatMap(existingOption => {
            if (Option.isSome(existingOption)) {
              // Update existing integration
              return Effect.tryPromise({
                try: async () => {
                  const [updated] = await db.update(userIntegrations)
                    .set({
                      credentialsEncrypted: encrypted.encrypted,
                      credentialsIv: encrypted.iv,
                      credentialsTag: encrypted.tag,
                      settings,
                      enabled: true,
                      updatedAt: new Date(),
                    })
                    .where(and(
                      eq(userIntegrations.userId, userId),
                      eq(userIntegrations.integrationType, integrationType)
                    ))
                    .returning()
                  if (!updated) {
                    throw new Error('Failed to update integration')
                  }
                  return updated
                },
                catch: (error) => new DatabaseError('Failed to update integration', error)
              })
            } else {
              // Create new integration
              return Effect.tryPromise({
                try: async () => {
                  const [newIntegration] = await db.insert(userIntegrations).values({
                    userId,
                    integrationType,
                    credentialsEncrypted: encrypted.encrypted,
                    credentialsIv: encrypted.iv,
                    credentialsTag: encrypted.tag,
                    settings,
                    enabled: true,
                  }).returning()
                  if (!newIntegration) {
                    throw new Error('Failed to create integration')
                  }
                  return newIntegration
                },
                catch: (error) => new DatabaseError('Failed to create integration', error)
              })
            }
          })
        )
      ),
      Effect.flatMap(integration =>
        Effect.try({
          try: () => integration as UserIntegration,
          catch: (error) => new DatabaseError('Invalid integration data returned from database', error)
        })
      ),
      Effect.mapError(error => {
        if (error._tag === "EncryptionError") {
          return new DatabaseError('Failed to encrypt credentials', error)
        }
        return error as DatabaseError
      })
    )

  const getIntegration = (
    userId: number,
    integrationType: string
  ): Effect.Effect<Option.Option<UserIntegration>, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        const [integration] = await db.select()
          .from(userIntegrations)
          .where(and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, integrationType)
          ))
        return integration || null
      },
      catch: (error) => new DatabaseError('Failed to get integration', error)
    }).pipe(
      Effect.flatMap(integration => {
        if (integration === null) {
          return Effect.succeed(Option.none())
        }
        return Effect.try({
          try: () => Option.some(integration as UserIntegration),
          catch: (error) => new DatabaseError('Invalid integration data from database', error)
        })
      })
    )

  const getUserIntegrations = (userId: number): Effect.Effect<UserIntegration[], DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        return await db.select()
          .from(userIntegrations)
          .where(eq(userIntegrations.userId, userId))
      },
      catch: (error) => new DatabaseError('Failed to get user integrations', error)
    }).pipe(
      Effect.flatMap(integrations =>
        Effect.try({
          try: () => integrations.map(integration => integration as UserIntegration),
          catch: (error) => new DatabaseError('Invalid integration data from database', error)
        })
      )
    )

  const getDecryptedIntegration = (
    userId: number,
    integrationType: string
  ): Effect.Effect<Option.Option<{ integration: UserIntegration; credentials: Record<string, any> }>, DatabaseError> =>
    getIntegration(userId, integrationType).pipe(
      Effect.flatMap(integrationOption => {
        if (Option.isNone(integrationOption)) {
          return Effect.succeed(Option.none())
        }

        const integration = integrationOption.value
        const encryptedData: EncryptedData = {
          encrypted: integration.credentialsEncrypted,
          iv: integration.credentialsIv,
          tag: integration.credentialsTag,
        }

        return encryption.decryptJson(encryptedData).pipe(
          Effect.map(credentials => Option.some({ integration, credentials })),
          Effect.mapError(error => new DatabaseError('Failed to decrypt integration credentials', error))
        )
      })
    )

  const getAllDecryptedIntegrations = (
    userId: number
  ): Effect.Effect<Array<{ integration: UserIntegration; credentials: Record<string, any> }>, DatabaseError> =>
    getUserIntegrations(userId).pipe(
      Effect.flatMap(integrations =>
        Effect.all(
          integrations.map(integration => {
            const encryptedData: EncryptedData = {
              encrypted: integration.credentialsEncrypted,
              iv: integration.credentialsIv,
              tag: integration.credentialsTag,
            }

            return encryption.decryptJson(encryptedData).pipe(
              Effect.map(credentials => ({ integration, credentials })),
              Effect.mapError(error => new DatabaseError('Failed to decrypt integration credentials', error))
            )
          })
        )
      )
    )

  const removeIntegration = (userId: number, integrationType: string): Effect.Effect<void, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        await db.delete(userIntegrations)
          .where(and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, integrationType)
          ))
      },
      catch: (error) => new DatabaseError('Failed to remove integration', error)
    })

  const toggleIntegration = (userId: number, integrationType: string, enabled: boolean): Effect.Effect<void, DatabaseError> =>
    Effect.tryPromise({
      try: async () => {
        await db.update(userIntegrations)
          .set({ enabled, updatedAt: new Date() })
          .where(and(
            eq(userIntegrations.userId, userId),
            eq(userIntegrations.integrationType, integrationType)
          ))
      },
      catch: (error) => new DatabaseError('Failed to toggle integration', error)
    })

  return UserRepository.of({
    createUser,
    getUser,
    getOrCreateUser,
    getUserSettings,
    updateUserSettings,
    addIntegration,
    getIntegration,
    getUserIntegrations,
    getDecryptedIntegration,
    getAllDecryptedIntegrations,
    removeIntegration,
    toggleIntegration,
  })
})

export const UserRepositoryLive = Layer.effect(UserRepository, makeUserRepository)
