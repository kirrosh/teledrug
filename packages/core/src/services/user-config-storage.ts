import { Effect, Context, Layer, Option, Cache, Duration } from "effect";
import { UserRepository } from "./user-repository";
import {
  type UserConfig,
  type UserIntegrationConfig,
} from "../schemas/database";
import { getMainModel } from "../config/ai-models";

export class UserConfigError {
  readonly _tag = "UserConfigError";
  constructor(readonly message: string, readonly cause?: unknown) {}
}

export interface UserConfigStorage {
  readonly get: (userId: number) => Effect.Effect<UserConfig, UserConfigError>;
  readonly addIntegration: (
    userId: number,
    integration: UserIntegrationConfig
  ) => Effect.Effect<void, UserConfigError>;
  readonly removeIntegration: (
    userId: number,
    integrationName: string
  ) => Effect.Effect<void, UserConfigError>;
  readonly createDefaultConfig: (
    userId: number,
    username?: string
  ) => Effect.Effect<UserConfig, UserConfigError>;
  readonly invalidate: (userId: number) => Effect.Effect<void>;
}

export const UserConfigStorage =
  Context.GenericTag<UserConfigStorage>("UserConfigStorage");

const makeUserConfigStorage = Effect.gen(function* () {
  const userRepository = yield* UserRepository;

  // Создаем Effect Cache с TTL и ограничением размера
  const configCache = yield* Cache.make({
    capacity: 1000, // максимум 1000 пользователей в кэше
    timeToLive: Duration.minutes(15), // данные живут 15 минут
    lookup: (userId: number) =>
      Effect.gen(function* () {
        // Получаем пользователя из БД
        const userOption = yield* userRepository.getUser(userId);
        if (Option.isNone(userOption)) {
          return yield* Effect.fail(
            new UserConfigError(`User ${userId} not found`)
          );
        }

        const user = userOption.value;

        const settings = yield* userRepository.getUserSettings(userId);
        const preferences = settings.preferences as
          | Record<string, unknown>
          | null
          | undefined;

        // Получаем все расшифрованные интеграции
        const integrations = yield* userRepository.getAllDecryptedIntegrations(
          userId
        );

        // Формируем конфигурацию пользователя
        const config: UserConfig = {
          userId: user.telegramId,
          username: user.username,
          settings: {
            timezone: settings.timezone,
            locale: settings.locale,
            city: settings.city ?? undefined,
            country: settings.country ?? undefined,
          },
          integrations: integrations.map(({ integration, credentials }) => ({
            name: integration.integrationType,
            credentials,
            enabled: integration.enabled,
            settings: integration.settings as Record<string, any> | undefined,
          })),
          aiSettings: {
            model: getMainModel(),
          },
          preferences: preferences ?? undefined,
        };

        console.log(`📦 Кэшируем конфигурацию для пользователя ${userId}`);
        return config;
      }).pipe(
        Effect.mapError(
          (error) =>
            new UserConfigError(
              "Database error while loading user config",
              error
            )
        )
      ),
  });

  const get = (userId: number): Effect.Effect<UserConfig, UserConfigError> =>
    configCache.get(userId);

  const addIntegration = (
    userId: number,
    integration: UserIntegrationConfig
  ): Effect.Effect<void, UserConfigError> =>
    Effect.gen(function* () {
      // Добавляем интеграцию в БД
      yield* userRepository
        .addIntegration(
          userId,
          integration.name,
          integration.credentials,
          integration.settings
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new UserConfigError(
                "Database error while adding integration",
                error
              )
          )
        );

      // Инвалидируем кэш - при следующем запросе данные обновятся
      yield* configCache.invalidate(userId);
      console.log(
        `🗑️ Кэш инвалидирован для пользователя ${userId} после добавления интеграции`
      );
    });

  const removeIntegration = (
    userId: number,
    integrationName: string
  ): Effect.Effect<void, UserConfigError> =>
    Effect.gen(function* () {
      // Удаляем интеграцию из БД
      yield* userRepository
        .removeIntegration(userId, integrationName)
        .pipe(
          Effect.mapError(
            (error) =>
              new UserConfigError(
                "Database error while removing integration",
                error
              )
          )
        );

      // Инвалидируем кэш
      yield* configCache.invalidate(userId);
      console.log(
        `🗑️ Кэш инвалидирован для пользователя ${userId} после удаления интеграции`
      );
    });

  const createDefaultConfig = (
    userId: number,
    username?: string
  ): Effect.Effect<UserConfig, UserConfigError> =>
    Effect.gen(function* () {
      // Создаем или получаем пользователя
      yield* userRepository
        .getOrCreateUser(userId, username)
        .pipe(
          Effect.mapError(
            (error) =>
              new UserConfigError(
                "Database error while creating default config",
                error
              )
          )
        );

      // Получаем конфигурацию (она автоматически попадет в кэш)
      return yield* get(userId);
    });

  const invalidate = (userId: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* configCache.invalidate(userId);
      console.log(`🗑️ Кэш инвалидирован для пользователя ${userId}`);
    });

  return UserConfigStorage.of({
    get,
    addIntegration,
    removeIntegration,
    createDefaultConfig,
    invalidate,
  });
});

export const UserConfigStorageLive = Layer.effect(
  UserConfigStorage,
  makeUserConfigStorage
);
