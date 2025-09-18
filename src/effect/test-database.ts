import { Effect, Layer, Console } from "effect"
import { EncryptionServiceLive } from "./services/encryption"
import { UserRepositoryLive } from "./services/user-repository"
import { UserConfigStorageLive } from "./services/user-config-storage"
import { UserRepository } from "./services/user-repository"
import { UserConfigStorage } from "./services/user-config-storage"

// Test program
const testProgram = Effect.gen(function* () {
  const userRepository = yield* UserRepository
  const userConfigStorage = yield* UserConfigStorage

  yield* Console.log("🧪 Начинаю тест базы данных...")

  // Test user creation
  const testUserId = 12345
  const testUsername = "test_user"

  yield* Console.log(`👤 Создаю пользователя ${testUserId}...`)
  const user = yield* userRepository.getOrCreateUser(testUserId, testUsername)
  yield* Console.log(`✅ Пользователь создан: ${JSON.stringify(user)}`)

  // Test user config creation
  yield* Console.log("⚙️ Создаю конфигурацию пользователя...")
  const config = yield* userConfigStorage.createDefaultConfig(testUserId, testUsername)
  yield* Console.log(`✅ Конфигурация создана: ${JSON.stringify(config)}`)

  // Test integration addition
  yield* Console.log("🔌 Добавляю тестовую интеграцию...")
  yield* userConfigStorage.addIntegration(testUserId, {
    name: "test-integration",
    credentials: { token: "secret-token", apiKey: "api-key-123" },
    enabled: true,
    settings: { timeout: 5000 }
  })
  yield* Console.log("✅ Интеграция добавлена")

  // Test getting integrations
  yield* Console.log("📊 Получаю список интеграций...")
  const updatedConfig = yield* userConfigStorage.get(testUserId)
  if (updatedConfig._tag === "Some") {
    yield* Console.log(`✅ Интеграции: ${JSON.stringify(updatedConfig.value.integrations)}`)
  } else {
    yield* Console.log("❌ Конфигурация не найдена")
  }

  yield* Console.log("🎉 Тест завершен успешно!")
})

// Create layers
const testLayer = Layer.mergeAll(
  EncryptionServiceLive,
  UserRepositoryLive.pipe(Layer.provide(EncryptionServiceLive)),
  UserConfigStorageLive.pipe(
    Layer.provide(
      UserRepositoryLive.pipe(Layer.provide(EncryptionServiceLive))
    )
  )
)

// Run test
const runTest = testProgram.pipe(
  Effect.provide(testLayer),
  Effect.catchAll(error => Console.log(`❌ Ошибка: ${error}`))
)

Effect.runPromise(runTest)