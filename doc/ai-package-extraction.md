# План выделения AI‑функциональности в отдельный пакет

## 0. Коротко
- Создаём workspace‑пакет `packages/ai` с едиными контрактами, фабрикой агентов и вспомогательными сервисами (анализ, транскрибация, тестовые хелперы).
- Выносим зависимости на OpenAI / Vercel AI SDK из `@teledrug/core`, оставляя в `core` только адаптеры к хранилищам и транспортам.
- Переписываем доменные `tool`‑модули так, чтобы они работали через интерфейсы (порт + адаптер), и переносим реализацию в новый пакет.
- Переносим и расширяем тесты (юнит/интеграция) внутри `packages/ai`, добавляем контрактные проверки для адаптеров.

## 1. Аудит текущего состояния

### Основные сервисы и файлы
- `packages/core/src/effect/services/ai-agent.ts` — оркестратор: нормализация истории, роутинг доменных агентов, исполнение и план.
- `packages/core/src/effect/services/integration-registry.ts` — собирает `tool`‑пакеты (digest, journal, tasks, calendar, settings) и метаданные, зависит от репозиториев и Yandex Calendar.
- `packages/core/src/effect/journal/tools.ts`, `tasks/tools.ts`, `digest/tools.ts`, `user/tools.ts`, `integrations/yandex-calendar/index.ts` — определения инструментов на базе `tool(...)` из `ai`, плотные зависимости на репозитории `@teledrug/core`.
- `packages/core/src/effect/services/journal-analysis.ts` — LLM-анализ дневников.
- `packages/core/src/effect/services/telegram-client.ts` — внутренняя логика транскрибации голосовых сообщений через `experimental_transcribe`.
- Общие типы и ошибки (`packages/core/src/effect/types/integrations.ts`, `packages/core/src/effect/services/errors.ts`) смешивают AI-контракты и доменные детали.

### Тестовое покрытие
- `tests/unit/ai-agent-routing.test.ts` — проверка плана агентов и нормализации истории.
- `tests/integration/agents/*.ts` — LLM-интеграционные сценарии под флагом `RUN_LLM_TESTS`.
- Внутренний harness (`tests/integration/agents/harness.ts`) и заметки в `doc/ai-agent-class-migration.md`, `doc/multi-agent-architecture.md`.

### Проблемы
- AI-код тесно связан с репозиториями и Telegram-слоем `core`, сложно переиспользовать.
- Нет явных портов/контрактов: `IntegrationRegistry` напрямую знает про хранилища и форматтеры.
- Тесты распределены по `tests/`, нет самостоятельного набора в пакете.
- Конфигурация (`process.env.OPENAI_API_KEY`) мутируется прямо в сервисе, усложняя параллельные сценарии и тестирование.

## 2. Целевой вид пакета `@teledrug/ai`

````markdown
packages/
  ai/
    package.json
    src/
      index.ts                     # публичные экспортируемые слои
      config.ts                    # чтение/валидация AI-конфига без прямого доступа к process.env
      errors.ts                    # AIAgentError, JournalAnalysisError, Tool ошибки
      contracts/
        tool-bundle.ts             # IntegrationToolsBundle, ToolFormatterResult и пр.
        ports/
          journal.ts               # интерфейсы к доменным сервисам
          tasks.ts
          digest.ts
          calendar.ts
          settings.ts
      agent/
        factory.ts                 # AIAgentFactoryLive
        router.ts                  # routeAgents, планировщик, доменные определения
        planner.ts                 # executeAgentPlan, short-circuit логика
        messages.ts                # normalizeHistory, buildMessages
      services/
        journal-analysis.ts
        transcription.ts
      tools/
        journal/index.ts           # createJournalTools (через порты)
        tasks/index.ts
        digest/index.ts
        settings/index.ts
        calendar/index.ts
      testing/
        mocks.ts                   # стабы ai-sdk, фикстуры форматов
        harness.ts                 # RUN_LLM_TESTS helper
    tests/
      unit/
        agent-plan.test.ts
        router.test.ts
        prompts.test.ts
      contract/
        tool-adapter.test.ts       # проверка соответствия портов
      integration/
        orchestrator.integration.test.ts
        transcription.integration.test.ts
    README.md                      # usage + настройка окружения
````

### Экспортируемые сущности
- `AIAgentFactory`, `AIAgent`, типы планов и ответов.
- `IntegrationToolsBundle`, `DomainAgentRegistry`, `ToolResultFormatter`.
- Порты для доменных зависимостей (`JournalPort`, `TaskPort` и т.д.).
- Сервисы `JournalAnalysisService`, `TranscriptionService`.
- Тестовые хелперы (флаги, фикстуры, стабы ai-sdk).

### Ограничения по зависимостям
- Разрешено: `effect`, `@effect/schema`, `ai`, `@ai-sdk/openai`, `zod`, лёгкие утилиты (`date-fns` при необходимости).
- Запрещено: прямые импорты из `@teledrug/core`, `@teledrug/db`, `telegram`. Связь только через порты или предоставленные функции.
- Общие типы (`ConversationMessage`, `InteractionType`) выносим либо в `packages/ai`, либо в маленький `packages/shared`/`@teledrug/contracts`, чтобы избежать цикла.

## 3. Фазы миграции

1. **Подготовка инфраструктуры**
   - Создать `packages/ai/package.json`, настроить `tsconfig`, `build`/`test` скрипты, обновить `bun.lock`.
   - Вынести базовые типы (`ConversationMessage`, `InteractionType`, ошибки AI) в `packages/ai/src/contracts`.
   - Добавить `README.md` с описанием окружения и запуска тестов.

2. **Контракты и порты**
   - Описать `ToolBundle`, `DomainAgentType`, `SimpleChatContext`, `AgentExecution` в `packages/ai`.
   - Определить порты (`JournalPort`, `TaskPort`, `DigestPort`, `CalendarPort`, `SettingsPort`, `UserConfigPort`, `ToolProgressPort`).
   - В `@teledrug/core` создать адаптеры, реализующие эти порты через существующие репозитории и сервисы, но пока оставив старый код рабочим.

3. **Миграция `AIAgent`**
   - Перенести код из `packages/core/src/effect/services/ai-agent.ts` в `packages/ai/src/agent`.
   - Инкапсулировать кеширование агентов, логику `HISTORY_REPLAY_LIMIT`, планировщик.
   - Заменить прямую работу с registry на dependency injection (`ToolRegistryPort`), избавиться от побочного `process.env`.
   - Обновить `packages/core` так, чтобы сервис импортировался из `@teledrug/ai`, но пока использовал старый `IntegrationRegistry`.

4. **Рефакторинг и перенос Registry**
   - Разбить `IntegrationRegistry` на:
     - `ToolRegistryPort` (интерфейс в `packages/ai`).
     - `IntegrationRegistryLive` (адаптер в `@teledrug/core`, собирающий tool-ы через существующие репозитории).
   - Переместить общие типы форматтеров/прогресса в `packages/ai`.

5. **Доменные `tool`‑модули**
   - Переписать `journal/tools.ts`, `tasks/tools.ts`, `digest/tools.ts`, `user/tools.ts`, `integrations/yandex-calendar/index.ts`, `services/journal-analysis.ts` на использование портов и перенести в `packages/ai/src/tools` и `packages/ai/src/services`.
   - В `@teledrug/core` оставить адаптеры/провайдеры, поставляющие порты (например, `JournalPortLive` собирает репозитории + форматтеры и передаёт в `packages/ai`).
   - Выделить общие утилиты форматирования в `packages/ai` или `packages/shared`.

6. **Транскрибация и вспомогательные сервисы**
   - Вынести работу с `experimental_transcribe` в `packages/ai/src/services/transcription.ts`.
   - Обновить `TelegramClient` (`packages/core/src/effect/services/telegram-client.ts`), чтобы он зависел от нового сервиса по интерфейсу.

7. **Тесты**
   - Перенести `tests/unit/ai-agent-routing.test.ts` → `packages/ai/tests/unit/agent-plan.test.ts`, адаптировать импорты.
   - Перенести `tests/integration/agents/*` → `packages/ai/tests/integration`, переписать пути на новый пакет, синхронизировать harness.
   - Добавить новые юнит-тесты на порты, формирование подсказок, обработку ошибок.
   - В `@teledrug/core` оставить тонкие smoke-тесты на адаптеры (можно через контрактные проверки или e2e сценарии Telegram).

8. **Очистка и документация**
   - Удалить остаточные импортов `ai` из `@teledrug/core`.
   - Обновить `doc/architecture-overview.md`, `doc/ai-agent-class-migration.md`, добавить ссылки на новый пакет.
   - Обновить CI/скрипты (`scripts/*`, `tests/README`) и окружение (`.env.sample`, `apps/*/.env`).

## 4. Контракты и зависимости

- **ToolRegistryPort** — единственная точка, которую `AIAgent` видит от остальной системы. Возвращает `IntegrationToolsBundle` для пользователя и типа взаимодействия.
- **DomainPorts** — каждый `tool` использует порт вместо прямого репозитория:  
  - `JournalPort`: `getJournalRepository`, `analysis`, `taskSuggestionWriter`.  
  - `TaskPort`: CRUD для задач, поиск, форматирование.  
  - `DigestPort`: чтение/обновление настроек, сборка snapshot.  
  - `CalendarPort`: доступ к Yandex CalDAV, форматирование событий.  
  - `SettingsPort`: чтение/запись настроек пользователя, валидации таймзон.
- **UtilityPort** — `LoggerPort`, `TelemetryPort`, `ToolProgressPort`, чтобы новый пакет не зависел от конкретной реализации логгера.
- **Shared Types** — `ConversationMessage`, `SimpleChatContext`, `AIUserConfig` переносим в новый пакет, обновляем импорты в остальных местах.

В `@teledrug/core` создаём адаптеры (`Layer`s), которые реализуют эти интерфейсы, используя уже существующие репозитории (`JournalRepository`, `TaskRepository`, и т.д.) и передают их в `packages/ai`.

## 5. Тестовая стратегия

- **Unit**
  - `agent-plan.test.ts`: проверка short-circuit/полного плана, нормализации истории, fallback-логики.
  - `router.test.ts`: сценарии маршрутизации по текстам с моками портов.
  - `prompts.test.ts`: снапшоты системных подсказок для доменных агентов (помогает отслеживать непреднамеренные изменения).
  - `journal-analysis.test.ts`: мок `ai` + проверка JSON-валидации.
  - `transcription.test.ts`: мок `experimental_transcribe`, проверка ошибок и таймаутов.

- **Contract**
  - Тесты адаптеров (`adapter conforms to JournalPort`): через фиктивные реализации портов и property-based сценарии.
  - Проверка сериализации инструментов (`tool` возвращает `Tool` с корректной схемой).

- **Integration**
  - `orchestrator.integration.test.ts`: полный прогон `AIAgent` с fake портами, проверка последовательности вызовов.
  - LLM-проверки под `RUN_LLM_TESTS=1` (через новый harness), доступ к реальному OpenAI ключу.
  - E2E для транскрибации (чтение `fixtures/*.ogg`).

- **Regression / Smoke в Core**
  - Несколько e2e сценариев в `tests/integration` оставляем, чтобы убедиться, что адаптеры корректно подключены к остальным слоям (Telegram, cron).

## 6. Риски и контрольные точки

- **Несогласованность контрактов**: при переносе типов все адаптеры должны собираться; проверяем TypeScript + слойные тесты.
- **Разрыв в зависимостях**: новые порты должны быть полностью покрыты существующими репозиториями; важно составить матрицу «порт ↔ реализация» до начала миграции.
- **Поведение LLM**: перенос подсказок может изменить ответы; используем снапшоты и интеграционные тесты с реальной моделью.
- **Prod-конфиг**: новая фабрика должна читать ключи/модели из конфигов без мутации `process.env`; обновляем окружение и Helm/PM2/launch-скрипты.
- **Размер PR**: этапы лучше разбивать на маленькие MR (контракты → agent → tools → registry → tests), иначе ревью затянется.

Контрольные точки:
1. Новый пакет собирается и проходит unit-тесты без зависимости от `@teledrug/core`.
2. `@teledrug/core` использует `@teledrug/ai` как готовый слой, все старые импорты `ai` убраны.
3. Интеграционные тесты Telegram/cron проходят с новым пакетом.

## 7. Чек-лист задач

- [ ] Scaffold `packages/ai` (package.json, tsconfig, build/test, README).
- [ ] Перенести и типизировать контракты (`IntegrationToolsBundle`, ошибки, сообщения).
- [ ] Имплементировать `AIAgent` и фабрику внутри нового пакета.
- [ ] Создать порты и адаптеры в `@teledrug/core`.
- [ ] Мигрировать доменные `tool`‑модули и сервисы анализа/транскрибации.
- [ ] Переписать `IntegrationRegistry` на новую архитектуру.
- [ ] Обновить Telegram/cron слои до использования новых сервисов.
- [ ] Перенести и расширить тесты, настроить отдельный `RUN_LLM_TESTS`.
- [ ] Обновить документацию и скрипты разработки.
- [ ] Провести финальную регрессию (manual + CI) и удалить мёртвый код в `core`.

---

Дополнительно см. существующие заметки: `doc/ai-agent-class-migration.md`, `doc/multi-agent-architecture.md`, `doc/architecture-overview.md` — их стоит синхронизировать после внедрения нового пакета.
