import { Effect, Context, Layer, Option, Ref } from "effect"
import { UserRepository } from './user-repository'
import {
  type UserConfig,
  type UserIntegrationConfig,
} from '../schemas/database'

export class UserConfigError {
  readonly _tag = "UserConfigError"
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface UserConfigStorage {
  readonly get: (userId: string | number) => Effect.Effect<Option.Option<UserConfig>, UserConfigError>
  readonly save: (config: UserConfig) => Effect.Effect<void, UserConfigError>
  readonly update: (userId: string | number, updates: Partial<UserConfig>) => Effect.Effect<void, UserConfigError>
  readonly addIntegration: (userId: string | number, integration: UserIntegrationConfig) => Effect.Effect<void, UserConfigError>
  readonly removeIntegration: (userId: string | number, integrationName: string) => Effect.Effect<void, UserConfigError>
  readonly createDefaultConfig: (userId: string | number, username?: string) => Effect.Effect<UserConfig, UserConfigError>
  readonly invalidate: (userId: string | number) => Effect.Effect<void>
}

export const UserConfigStorage = Context.GenericTag<UserConfigStorage>("UserConfigStorage")

const makeUserConfigStorage = Effect.gen(function* () {
  const userRepository = yield* UserRepository
  const configCache = yield* Ref.make(new Map<string | number, UserConfig>())

  const normalizeUserId = (userId: string | number): number => {
    return typeof userId === 'string' ? parseInt(userId) : userId
  }

  const get = (userId: string | number): Effect.Effect<Option.Option<UserConfig>, UserConfigError> =>
    Ref.get(configCache).pipe(
      Effect.flatMap(cache => {
        // Check cache first
        if (cache.has(userId)) {
          const cachedConfig = cache.get(userId)!
          return Effect.succeed(Option.some(cachedConfig))
        }

        // Load from database
        const numericUserId = normalizeUserId(userId)

        return userRepository.getUser(numericUserId).pipe(
          Effect.flatMap(userOption => {
            if (Option.isNone(userOption)) {
              return Effect.succeed(Option.none())
            }

            const user = userOption.value

            return userRepository.getAllDecryptedIntegrations(numericUserId).pipe(
              Effect.flatMap(integrations => {
                const config: UserConfig = {
                  userId: user.telegramId,
                  username: user.username,
                  integrations: integrations.map(({ integration, credentials }) => ({
                    name: integration.integrationType,
                    credentials,
                    enabled: integration.enabled,
                    settings: integration.settings as Record<string, any> | undefined,
                  })),
                  aiSettings: {
                    model: 'gpt-5-nano',
                  },
                }

                return Effect.try({
                  try: () => config as UserConfig,
                  catch: (error) => new UserConfigError('Invalid config data', error)
                }).pipe(
                  Effect.flatMap(validConfig =>
                    Ref.update(configCache, cache => {
                      cache.set(userId, validConfig)
                      return cache
                    }).pipe(
                      Effect.map(() => Option.some(validConfig))
                    )
                  )
                )
              })
            )
          }),
          Effect.mapError(error => {
            return new UserConfigError('Database error while loading user config', error)
          })
        )
      })
    )

  const save = (config: UserConfig): Effect.Effect<void, UserConfigError> =>
    Effect.gen(function* () {
      const validConfig = config // Remove validation for now
      const numericUserId = normalizeUserId(validConfig.userId)

      // Ensure user exists
      yield* userRepository.getOrCreateUser(numericUserId, validConfig.username).pipe(
        Effect.mapError(error => new UserConfigError('Database error while saving user config', error))
      )

      // Save each integration
      yield* Effect.all(
        validConfig.integrations.map(integration =>
          userRepository.addIntegration(
            numericUserId,
            integration.name,
            integration.credentials,
            integration.settings
          ).pipe(
            Effect.mapError(error => new UserConfigError('Database error while saving integration', error))
          )
        )
      )

      // Update cache
      yield* Ref.update(configCache, cache => {
        cache.set(validConfig.userId, validConfig)
        return cache
      })
    })

  const update = (userId: string | number, updates: Partial<UserConfig>): Effect.Effect<void, UserConfigError> =>
    get(userId).pipe(
      Effect.flatMap(configOption => {
        if (Option.isNone(configOption)) {
          return Effect.fail(new UserConfigError(`User config not found for userId: ${userId}`))
        }

        const existing = configOption.value
        const updated = { ...existing, ...updates }

        return save(updated).pipe(
          Effect.flatMap(() =>
            // Clear cache to force reload
            Ref.update(configCache, cache => {
              cache.delete(userId)
              return cache
            })
          )
        )
      })
    )

  const addIntegration = (userId: string | number, integration: UserIntegrationConfig): Effect.Effect<void, UserConfigError> =>
    Effect.gen(function* () {
      const numericUserId = normalizeUserId(userId)

      yield* userRepository.addIntegration(
        numericUserId,
        integration.name,
        integration.credentials,
        integration.settings
      ).pipe(
        Effect.mapError(error => new UserConfigError('Database error while adding integration', error))
      )

      // Clear cache to force reload
      yield* Ref.update(configCache, cache => {
        cache.delete(userId)
        return cache
      })
    })

  const removeIntegration = (userId: string | number, integrationName: string): Effect.Effect<void, UserConfigError> =>
    Effect.gen(function* () {
      const numericUserId = normalizeUserId(userId)

      yield* userRepository.removeIntegration(numericUserId, integrationName).pipe(
        Effect.mapError(error => new UserConfigError('Database error while removing integration', error))
      )

      // Clear cache to force reload
      yield* Ref.update(configCache, cache => {
        cache.delete(userId)
        return cache
      })
    })

  const createDefaultConfig = (userId: string | number, username?: string): Effect.Effect<UserConfig, UserConfigError> =>
    Effect.gen(function* () {
      const numericUserId = normalizeUserId(userId)

      // Create user in database
      yield* userRepository.getOrCreateUser(numericUserId, username).pipe(
        Effect.mapError(error => new UserConfigError('Database error while creating default config', error))
      )

      // Return the created config (will have empty integrations array)
      const configOption = yield* get(userId)
      if (Option.isSome(configOption)) {
        return configOption.value
      } else {
        return yield* Effect.fail(new UserConfigError('Failed to create default user config'))
      }
    })

  const invalidate = (userId: string | number): Effect.Effect<void> =>
    Ref.update(configCache, cache => {
      cache.delete(userId)
      return cache
    })

  return UserConfigStorage.of({
    get,
    save,
    update,
    addIntegration,
    removeIntegration,
    createDefaultConfig,
    invalidate,
  })
})

export const UserConfigStorageLive = Layer.effect(UserConfigStorage, makeUserConfigStorage)