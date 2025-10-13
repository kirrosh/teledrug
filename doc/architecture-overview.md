# TeleDrug Architecture Overview

## Purpose And Domain
- TeleDrug is a Bun/TypeScript monorepo that delivers an AI powered Telegram assistant, scheduled digests, and a companion mini app.
- Core capabilities: OpenAI backed conversation orchestration, Yandex Calendar integration, journal capture with sentiment analysis, task management, and configurable daily digests.
- Architecture is built on Effect (effect-ts) for dependency management, layering, and async orchestration. Data is stored in PostgreSQL using Drizzle ORM.

## End-To-End Runtime Flow
1. `apps/bot/src/index.ts` bootstraps the Effect program exported from `packages/core/src/effect/index.ts`.
2. `BotApplication` (`packages/core/src/effect/services/bot-application.ts`) starts the `TelegramClient`.
3. `TelegramClient` (`packages/core/src/effect/services/telegram-client.ts`) receives Telegram updates, manages progress UX, and delegates user content to an orchestrator AI agent.
4. `AIAgentFactory` (`packages/core/src/effect/services/ai-agent.ts`) returns a cached agent instance per user. The agent:
   - Normalises chat history from `MessageHistory`.
   - Queries `IntegrationRegistry` for domain specific tool bundles.
   - Calls the router prompt to decide which domain agents to run (journal, tasks, calendar, digest, settings).
   - Executes each domain agent sequentially; each agent invokes AI tools declared by the integrations and writes results via the provided formatters.
5. Tool implementations talk to repositories such as `JournalRepository`, `TaskRepository`, `DigestSettingsRepository`, and Yandex Calendar wrappers. Tool results are formatted into Telegram messages.
6. `TelegramClient` aggregates tool results, updates the progress message, and posts the final reply. Conversation history and journal/tasks side effects persist to PostgreSQL.
7. Scheduled jobs (`packages/core/src/effect/cron/*.ts`) reuse the same repositories and digest modules to push morning digests or evening prompts via Telegram HTTP API.
8. The mini app (`apps/miniapp`) reads the same database through server actions for journal and task dashboards after TELEGRAM WebApp based authentication.

## Repository Layout
- `packages/core`: Effect based domain logic, integrations, repositories, and cron jobs.
- `packages/db`: Shared Drizzle ORM package with schema definitions, PostgreSQL client, and migrations.
- `packages/og`: OG image renderer for digest cards using `@vercel/og`.
- `apps/bot`: Bun entry point that runs the Telegram bot and optional health server.
- `apps/daily-greeting`: Bun entry points that run the morning digest and evening prompt jobs.
- `apps/miniapp`: Next.js 15 TeleDrug mini app with server actions, SWR, and Telegram WebApp auth.
- `tests`: Bun unit tests and optional LLM integration harness.
- `scripts`: Developer utilities (e.g., run bot + mini app with ngrok tunnelling).
- `doc`: Project notes and this architecture report.

## Database Package (`packages/db`)
- Exports `db`/`sql` clients (Postgres + Drizzle) and all table/type definitions from `schema.ts`.
- Hosts canonical migrations under `packages/db/migrations` and a `drizzle.config.ts` for CLI usage.
- Shared across `@teledrug/core`, cron jobs, and the mini app to ensure a single source of truth for schema and database access.

## Core Package (`packages/core`)

### Runtime And Layers
- `effect/index.ts`: Validates critical env vars, resolves `MainLayer`, starts `BotApplication`, traps SIGINT/SIGTERM, and sleeps to keep the process alive.
- `effect/layers/main.ts`: Declares dependency graph. Provides:
  - Cryptography/encryption services (AES-GCM with `ENCRYPTION_MASTER_KEY`).
  - Database backed repositories (user, digest, journal, tasks).
  - `UserConfigStorage` cache (Effect Cache with 15 minute TTL).
  - `IntegrationRegistry` with domain tool bundles.
  - `AIAgentFactoryLive` configured with OpenAI API key and default model.
  - `TelegramClientLive` configured with `BotConfig` (token, optional mini app URL).
  - Wraps everything into the `BotApplicationLive` layer.
- `effect/layers/daily-digest.ts`: Minimal layer supplying `DigestSettingsRepository`, `UserRepository` (with encryption), and `TaskRepository` for cron jobs.

### Service Modules
#### `telegram-client.ts`
- Responsibilities: Telegram bot lifecycle, command routing, audio transcription, AI agent orchestration, progress messaging, mini app menu integration, inline callbacks for journal and tasks.
- Inputs: `BotConfig` (token, optional `webAppUrl`), Telegram updates, `UserConfigStorage`, `AIAgentFactory`, `MessageHistory`, `IntegrationRegistry`, `JournalRepository`, `TaskRepository`, `ToolProgressReporter`.
- Outputs: Start/stop effects, message send effect, per update handler. Side effects include Telegram API calls, OpenAI transcription requests, caching conversation history, and repository writes for journal/tasks.
- Commands: `/start`, `/app` (with validation of HTTPS mini app URL), `/clear` (resets history), `/integrations` (reads cached user config).
- Interaction types: TEXT, VOICE, AUDIO. Voice/audio routed through OpenAI `gpt-4o-mini-transcribe`.
- Inline callbacks: journal deletion, creating tasks from journal suggestions; handles button state updates.

#### `bot-application.ts`
- Facade that starts/stops `TelegramClient` and provides `sendEcho`. Ensures errors are wrapped inside `BotApplicationError`.

#### `ai-agent.ts`
- Contains orchestrator logic.
- Configuration schema: API key, model (default `gpt-4o-mini`), max tokens, per-user id.
- `processMessage(context, history)`:
  - Validates context via Effect schema.
  - Normalises history to last 10 messages.
  - Builds base messages (user/assistant roles preserved).
  - Loads domain tool bundles via `IntegrationRegistry.getDomainToolsForUser`.
  - Router prompt selects relevant domain agents, emphasising rules for tasks, calendar, journal, digest, settings.
  - Executes domain agents sequentially (`runDomainAgent`); each agent:
    - Constructs system prompt with domain specific rules.
    - Attaches per-domain tool schema (AI tool definitions).
    - Uses `generateText` to call OpenAI with provided tools and plan.
  - Aggregates tool formatters/progress messages from successful executions.
- Response: `AIAgentResponse` includes executed agent results, plan metadata, combined formatters, progress messages, and a flag if fallback routing was used.
- Factory: `AIAgentFactory` caches agents per user (Effect Cache TTL 1h) and can invalidate entries. Supports `createAgent` with overrides.

#### `integration-registry.ts`
- Purpose: Hydrates domain specific tool bundles for a user and interaction type.
- Dependencies: `UserRepository`, `DigestSettingsRepository`, `JournalAnalysisService`, `JournalRepository`, `TaskRepository`.
- Flow:
  - Normalises numeric user id.
  - Loads digest tools (`createDigestTools`).
  - Loads journal tools (`createJournalTools`) with journal analysis and repositories.
  - Loads user settings (timezone/locale) with safe defaults on failure.
  - Loads task tools (`createTaskTools`) with user settings snapshot.
  - Loads user settings tools (`createUserSettingsTools`) so digest modules update after location/timezone changes.
  - Fetches decrypted integrations (AES-GCM) via `UserRepository`.
  - Currently only Yandex Calendar: builds tools via `YandexCalendarIntegration.createTools`, merges context messages, formatters, and progress strings.
  - Produces combined tool map for orchestrator plus domain partition map.

#### `digest-settings.ts`
- Database repository for per-user module toggles.
- Responsibilities: ensure default modules seeded, fetch module settings, update individual module state/settings, toggle whole digest on/off.
- Defaults: weather (metric Moscow), fx (USD/RUB), calendar, tasks.
- Uses Drizzle to join `digestModules` and `digestModuleSettings`.

#### `journal-analysis.ts`
- Wraps OpenAI `generateText` call with deterministic JSON response (mood, energy, title, tags).
- Validates output using zod schema and sanitises fallback title.
- Returns `JournalAnalysisResult` and maps errors to `JournalAnalysisError`.

#### `journal-repository.ts`
- PostgreSQL operations for journal entries and tags within `journal` schema.
- Methods: `createEntry`, `deleteEntry`, `findEntry`.
- Inserts tags, ensures uniqueness through join tables, associates tags via `journalEntryTags`.

#### `task-repository.ts`
- PostgreSQL backed task CRUD and query helpers.
- Key methods: `create`, `complete`, `listForToday` (time zone aware), `countOverdue`, `listOpen`, `listByFilters`, `delete`, `update`, `findById`, `findByTitleLike`.
- Handles timezone computations via `getDayBoundsInTimezone`.

#### `message-history.ts`
- In-memory `Ref` storing last 20 messages per chat. Used to replay context to OpenAI.
- Methods: add user/assistant messages, fetch/clear history, get counts or recent subset.
- TODO from notes: currently replays entire trimmed history; known regression doc suggests refinements.

#### `user-repository.ts`
- Drizzle repository for users, settings, integrations.
- Ensures user settings exist, updates settings (timezone/locale/city/country/preferences), manages encrypted integrations via `EncryptionService`, ensures digest defaults.
- Exposes helpers to fetch decrypted integration credentials and to toggle integrations.

#### `user-config-storage.ts`
- Effect Cache (capacity 1000, TTL 15m) storing aggregated user config.
- Provides `get`, `addIntegration`, `removeIntegration`, `createDefaultConfig`, `invalidate`.
- Combines repository data and decrypted integrations for quick `/integrations` command responses.

#### `cryptography.ts` and `encryption.ts`
- AES-256-GCM encryption services. `cryptography.ts` emits `CryptographyError` using `@effect` errors; `encryption.ts` provides plain classes used by repositories.
- Both expect a 32 byte hex `ENCRYPTION_MASTER_KEY`, with dev fallback auto generated key and console warning.

#### `journal-analysis`, `journal-repository`, `task-repository`, `user-repository`, `digest-settings`
- Collaborate to persist LLM outputs, digest settings, user profile, and tasks.

### Domain Tool Modules

#### Digest (`packages/core/src/effect/digest`)
- `types.ts`: defines digest module ids, context snapshot, and Effect interface for modules.
- `modules/weather.ts`: Calls Open-Meteo APIs (geocoding + forecast), caches by location, returns summary line.
- `modules/fx.ts`: Uses open.er-api.com for FX rates, caches responses, computes 30 day change.
- `modules/calendar.ts`: Reads Yandex credentials, fetches events via CalDAV (`fetchEventsForRange`), formats entries in user locale/timezone.
- `modules/tasks.ts`: Uses `TaskRepository` to summarise today's tasks + overdue count.
- `runner.ts`: `runDailyDigest(userId, date, options)` loads module settings, user settings snapshot, and executes modules sequentially.
- `tools.ts`: AI tool `updateDigestSettings` allowing LLM to toggle modules or update weather/FX preferences.

#### Journal (`packages/core/src/effect/journal`)
- `model.ts`: Mood/energy enums, emoji maps, helper to sanitise titles.
- `tools.ts`: AI tool `createJournalEntry`:
  - Validates content via zod schema.
  - Runs `JournalAnalysisService` to determine mood/energy/tags.
  - Writes entry using `JournalRepository`.
  - Extracts suggested tasks via `generateObject`, offering quick buttons to create tasks or delete entry.
  - Formatter returns Markdown with inline keyboard metadata for Telegram.

#### Tasks (`packages/core/src/effect/tasks/tools.ts`)
- Declares single tool `manageTasks`.
- Input schema allows create/update/complete/delete/reschedule operations with validation.
- Resolves tasks via repository (by id or fuzzy title), ensures outputs summarise operations with Markdown formatting.
- Additional tool `listTasks` (within same file) returns formatted lists with markdown table like output and metadata.

#### User (`packages/core/src/effect/user/tools.ts`)
- Tool `updateUserSettings`: handles timezone, locale, location, and preferences patching.
- Performs heuristic lookup for Russian city/timezone names.
- After location change, triggers digest weather module update via `DigestSettingsRepository`.
- Formatter summarises applied updates and warnings.
- Provides optional context messages to steer LLM on digest refresh obligations.

### Integrations
#### Yandex Calendar (`packages/core/src/effect/integrations/yandex-calendar/index.ts`)
- Provides `YandexCredentials` schema and helpers:
  - `fetchEventsForRange(credentials, start, end)` to pull CalDAV events.
  - `createTools({ credentials, encryptedCredentials, userTimezone, userLocale })`: builds AI tools for listing events and creating events.
  - Formats results into Telegram ready messages (Markdown/HTML depending on card).
  - Tracks progress messages via `ToolProgressReporter`.
  - Handles ICS parsing, date normalisation, attendee list formatting, and error reporting.
- Known issue from doc: result formatter currently formats times in server timezone; fix required.

### Shared Utilities
- `effect/shared/timezone.ts`: validates timezones, computes day bounds, formats in user locale/timezone, caches Intl formatters.
- `effect/core/tool-progress.ts`: Tag for injecting progress reporter (used to update Telegram progress messages).
- `effect/types/*`: Common schemas for encrypted data, messages, and integration metadata/errors.
- `effect/errors/index.ts`: Domain specific error tags (cryptography, history, Telegram, config, AI).

## Data Storage (`packages/core/src/storage`)
- `database/schema.ts`: Drizzle schema definitions.
  - `users`: Telegram id primary key, username, timestamps.
  - `user_settings`: timezone, locale, city, country, preferences (JSON).
  - `user_integrations`: encrypted credentials (text + IV + tag), enabled, settings JSON.
  - `digest_modules` & `digest_module_settings`: module registry and per-user enable/settings.
  - `journal.tags`, `journal.entries`, `journal.entry_tags`: mood/energy/tags enriched diary.
  - `tasks`: simple todo list with status, optional due date.
- `database/client.ts`: Connects to PostgreSQL using `DATABASE_URL` (default local DSN). Exports Drizzle client and `sql` connection for manual queries/closing.
- Migrations live in `database/migrations` (drizzle kit generated SQL).

## Cron Jobs (`packages/core/src/effect/cron`)
- `send-daily-greeting.ts`:
  - Optionally accepts `--all`/`--force-all` CLI flags to ignore time gating.
  - Fetches users with timezone settings around target hour (10:00).
  - Runs `runDailyDigest`, truncates results to four cards, converts digest to OG image via `@teledrug/og`.
  - Sends Telegram messages with caption + uploaded image using HTTP API (not grammy).
  - Relies on `DailyDigestLayer` for dependencies; closes DB connection on exit.
- `send-evening-prompt.ts`:
  - At 20:00 local time per user, sends preset reflective prompt.
  - Uses raw Telegram HTTP API and Drizzle fetch like the morning job.

## OG Renderer (`packages/og`)
- `daily-digest.tsx`: React component rendered by `@vercel/og` to produce 1200x630 images summarising digest cards.
- Accepts `DailyDigestImagePayload` (date label, cards, optional footnote). Cards include icon, title, accent color, lines.
- Exported via `renderDailyDigestImage` returning `Uint8Array`.

## Applications

### Telegram Bot (`apps/bot`)
- `src/index.ts`: Imports `@teledrug/core/effect/index` (side effect start) and optionally serves a simple health endpoint when `BOT_HEALTH_SERVER_ENABLED` is true (default).
- Provides `/` and `/health` responses with JSON timestamp.
- Port defaults to `PORT` or 3000.

### Daily Greeting CLI (`apps/daily-greeting`)
- `src/index.ts`: Imports morning cron entry; `src/evening.ts` imports evening prompt. Scripts run via Bun (`bun run src/index.ts`).

### Mini App (`apps/miniapp`)
- Next.js 15 + Turbopack app for Telegram WebApp context.
- Authentication:
  - `lib/telegram.ts`: Validates Telegram `initData` using HMAC, ensures freshness.
  - `lib/session.ts`: Iron Session setup (`IRON_SESSION_PASSWORD`, optional `IRON_SESSION_COOKIE_NAME`).
  - `hooks/useTelegramAuth.ts`: Client hook orchestrating auto auth via Telegram `WebApp`.
- Server Actions:
  - `actions/action-client.ts`: Wraps `next-safe-action` with session context.
  - `actions/session.ts`: Retrieve session payload, authorise via Telegram init data, logout.
  - `actions/journal.ts`: Query `journalEntries` for authorised user, return `JournalResponse`.
  - `actions/tasks.ts`: Query tasks with optional status filter.
- Pages:
  - `app/page.tsx`, `app/journal/page.tsx`, `app/tasks/page.tsx`: Render dashboards with SWR hooks (`useJournalData`, `useTasksData`) and UI components (`JournalEntryCard`, `TaskCard`, `BottomNav`, `AuthStatusCard`).
  - Uses Tailwind 4 with CSS modules, `lucide-react` icons, view transitions.
- Types: `types/api.ts` defines DTOs shared between client and server actions; `types/telegram.d.ts` extends global Telegram WebApp typing.
- Environment: requires Telegram bot token for auth validation and Iron Session secrets.

## Tests (`tests`)
- Unit:
  - `tests/unit/ai-agent-routing.test.ts`: Validates routing heuristics for domain agents.
  - `tests/unit/calendar-formatting.test.ts`: Covers calendar formatter logic.
- Integration (LLM dependent):
  - `tests/integration/agents/*.integration.test.ts` use harness (`tests/integration/agents/harness.ts`) with optional `RUN_LLM_TESTS=1`.
  - Each file targets a domain agent (calendar, digest, journal, settings, tasks, orchestrator) ensuring tool call behaviour via actual OpenAI model.
- Harness exposes helpers to skip tests without OpenAI credentials, enforce tool usage, and detect transient network errors.

## Scripts
- `scripts/dev-miniapp-with-bot.ts`: Spawns bot, mini app, and optional ngrok tunnel.
  - CLI flags: `--skip-bot`, `--force`, `--yes`, etc.
  - Validates/ensures port availability, provides interactive prompt to start bot, cleans up child processes and ngrok on shutdown.

## Configuration And Environment
- Critical env vars:
  - `TELEGRAM_BOT_TOKEN` (bot + jobs + mini app auth).
  - `OPENAI_API_KEY` (AI agent + transcription + analysis).
  - `WEBAPP_URL` (optional, must be HTTPS).
  - `DATABASE_URL` (PostgreSQL DSN).
  - `ENCRYPTION_MASTER_KEY` (64 hex chars for AES-256-GCM).
  - `IRON_SESSION_PASSWORD`, `IRON_SESSION_COOKIE_NAME` (mini app).
  - `BOT_HEALTH_SERVER_ENABLED`, `PORT` (bot health server).
  - `RUN_LLM_TESTS`, `LLM_TEST_MODEL` (tests).
  - `MINIAPP_PORT`, `STACK_*` flags for `dev-miniapp-with-bot` script.
- External services: OpenAI (text + transcription), Yandex CalDAV endpoint, Open-Meteo, open.er-api.com, Telegram Bot API, ngrok (dev script).

## Known Issues And Notes
- `doc/notes/tasks-calendar-issue-analysis.md` documents regressions:
  - History replay loses roles; routing misclassifies tasks vs calendar.
  - Calendar formatter ignores user timezone, causing Telegram/UI mismatch.
  - Router lacks explicit rule for completion intents.
  - Recommendation: fix `MessageHistory` role preservation, adjust router prompt, normalise timezones in calendar formatter, limit duplicate calendar tool calls.
- Some services exist in both `cryptography.ts` and `encryption.ts`; ensure future rewrite unifies responsibilities.
- Weather/FX modules cache results in memory; consider TTL or invalidation if deployed across multiple instances.
- Yandex calendar integration currently only triggered for TEXT/VOICE interactions; add IMAGE/FORWARD support if needed.

## Rebuild Considerations
- Maintain Effect layer structure for deterministic DI; when rewriting, map each service contract to new implementation or alternative DI container.
- Decouple AI prompts and tool contracts into dedicated spec documents to simplify future model migration.
- Preserve tool formatter outputs (Markdown/Inline keyboard format) for Telegram compatibility.
- Database schema is a single source of truth for tasks/journal/digest; migrations should be regenerated via drizzle-kit when reworking models.
- Mini app relies on the same database; any API surface replacement must provide equivalent queries or move to HTTP endpoints consumed by SWR hooks.
- Cron jobs expect to be launched via Bun entrypoints with necessary env. Provide equivalent scheduling or integrate into a job runner.

## Module Dependency Summary
- User message pipeline: `TelegramClient` -> `MessageHistory` -> `AIAgentFactory` -> `IntegrationRegistry` -> domain tools (`journal/tools`, `tasks/tools`, `digest/tools`, `user/tools`, `integrations/yandex-calendar`) -> repositories/externals -> formatted Telegram response.
- Scheduled digest: `send-daily-greeting.ts` -> `runDailyDigest` -> digest modules + repositories -> `renderDailyDigestImage` -> Telegram API.
- Mini app: `useTelegramAuth` -> `authorizeTelegramAction` -> `validateTelegramInitData` -> `IronSession` -> Drizzle queries (`actions/journal.ts`, `actions/tasks.ts`).

This document should serve as the baseline technical specification for the upcoming rewrite. Update alongside implementation changes to keep the architecture map accurate.
