# PRD: TeleDrug Daily Digest & Notification Platform

## 1. Background & Problem Statement

- TeleDrug users rely on the AI assistant for day-to-day planning but currently receive updates only reactively when they ask questions.
- We want to push proactive, personalized morning digests via Telegram so that users do not need to pull information manually.
- Initial scope is a lightweight daily summary (weather + exchange rates) with extensibility for future content types and delivery channels.

## 2. Goals & Non-Goals

### Goals

1. Deliver a configurable morning digest to each active user once per day (default 08:00 in user timezone).
2. Allow users to manage digest settings via AI tools: enable/disable digest, change weather location, change FX currency pair.
3. Store settings in our PostgreSQL database and run notification scheduling via a background queue (Redis-based).
4. Make architecture easy to extend with new digest modules (e.g., reminders, tasks, integrations).

### Non-Goals (for this iteration)

- Rich media digests (images, inline keyboards).
- Channels beyond Telegram.
- Real-time updates (only daily).
- Complex recommendation engine for suggested digest sections (collect feedback only).

## 3. Success Metrics

| Metric                          | Target                                    |
| ------------------------------- | ----------------------------------------- |
| Daily digests sent successfully | 95% of scheduled users                    |
| Users who customize settings    | 40% within first month                    |
| Delivery latency                | ≤ 2 minutes deviation from scheduled time |
| Error budget                    | < 1% failed job executions per day        |

## 4. Personas & User Stories

### Persona: Busy Consultant (primary)

Wants morning snapshot of weather (for commute) and FX (for client billing).

### User Stories

1. **As a user**, I receive one digest message every morning with weather and FX summary.
2. **As a user**, I can disable/enable the digest via natural language or tool command.
3. **As a user**, I can set my preferred weather location.
4. **As a user**, I can set my preferred currency pair.
5. **As a user**, I can request addition of a new digest section (stores proposal for later review).

## 5. Functional Requirements

### 5.1 Digest Content Modules

- **Weather module**

  - Inputs: location (city name or lat/lon), preferred units (metric/imperial default metric).
  - Data source: placeholder stub service (later integrate real weather API).
  - Output: text summary (e.g., "🌤️ Moscow: +5°C high, -1°C low, wind 12 km/h").

- **FX module**

  - Inputs: base currency, target currency (default USD/RUB).
  - Data source: placeholder stub service (later integrate real FX API).
  - Output: text summary (e.g., "💱 USD/RUB = 92.34 (+0.15%)").

- Modules implement `DigestModule` interface: `prepare(userContext, settings) -> Effect<string>`.

### 5.2 Scheduling & Delivery

- Use Redis (e.g., `bullmq` equivalent via Effect or `@effect/platform` queue) for job queue.
- Daily scheduler enqueues jobs at user-specific cron (initially 08:00 user local time, fallback to 08:00 UTC if timezone missing).
- Worker consumes jobs, composes digest text by invoking modules, sends via TelegramClient service (`sendMessage`).
- Job idempotency: skip duplicate jobs if digest already sent for same user/time bucket.

### 5.3 Settings Persistence

- Extend DB schema:
  - Table `digest_settings`: `user_id`, `enabled`, `timezone`, `weather_location`, `weather_units`, `fx_base`, `fx_quote`, `updated_at`.
  - Table `digest_preferences_log` (optional later) to track historical changes & user suggestions.
- Integrate with `UserRepository` / new repository module for digest settings (Effect service `DigestSettingsRepository`).

### 5.4 AI Tools Interface

- Add built-in tools accessible to all users:
  1. `digest_toggle` (enable/disable boolean).
  2. `digest_set_weather(location, units?)`.
  3. `digest_set_fx(base, quote)`.
  4. `digest_request_feature(request_text)` (stores suggestion for future modules) not now.
- Tools update DB through repository, emit success messages, and adjust caches (UserConfigStorage) as needed.

### 5.5 Telemetry & Monitoring

- Log each digest job execution (start/end, modules invoked, success/failure).
- Track metrics via console logs for now (later integrate with external monitoring).
- Provide admin command to query upcoming schedules per user for debugging.

## 6. Non-Functional Requirements

- **Reliability**: Scheduler retries job up to 3 times with exponential backoff.
- **Scalability**: Design modules as pure Effects so we can parallelize module fetching.
- **Security**: No sensitive secrets in digest text; sanitize user-provided location strings.
- **Config**: Environment variables for Redis URL, default timezone, API stubs.

## 7. Architecture Overview

```
┌────────────────┐      ┌────────────────────┐
│ Scheduler (cron│─────▶│ Redis Job Queue    │
│   service)     │      └─────┬──────────────┘
└──────┬─────────┘            │consume
       │enqueues               ▼
       │              ┌────────────────────┐
       │              │ Digest Worker      │
       │              │ - load settings    │
       │              │ - run modules      │
       │              │ - send Telegram    │
       │              └────────────────────┘
       │                         │
       │                         ▼
┌──────▼─────────┐      ┌────────────────────┐
│ DB (Postgres)  │◀────│ DigestSettingsRepo │
└────────────────┘      └────────────────────┘
```

### Effect Integration

- New services/modules:
  - `DigestSettingsRepository` (Layer on top of Drizzle).
  - `DigestScheduler` (Effect based cron + Redis producer).
  - `DigestWorker` (Effect runtime consuming queue).
  - `DigestModuleRegistry` (maps module ids to implementations).

## 8. UX & Messaging

- Telegram digest example:

```
🌞 Доброе утро, Кирилл!

🌤️ Москва: +5°C / -1°C, ветер 12 км/ч
💱 USD/RUB = 92.34 (+0.15%)

🔧 Изменить дайджест: скажи «Обнови мой дайджест»
```

- Tool confirmation responses: simple text (e.g., "✅ Дайджест включён."
  ).

## 9. Rollout Plan

1. **Phase 1**: Implement DB schema, repository, stub modules, queue skeleton, manual trigger CLI.
2. **Phase 2**: Integrate scheduler, send digest to internal test users.
3. **Phase 3**: Release tools to end users, collect feedback, monitor logs.
4. **Phase 4**: Add user suggestion capture + additional modules.

## 10. Risks & Mitigations

| Risk                   | Mitigation                                                              |
| ---------------------- | ----------------------------------------------------------------------- |
| Redis unavailable      | Fallback to in-memory schedule for dev; alert on connection failure     |
| Weather/FX API down    | Retain last successful value; show "service unavailable" notice         |
| Telegram rate limits   | Batch sends with small delays; reuse existing TelegramClient throttling |
| User timezones missing | Default to 08:00 UTC; prompt user to set timezone via tool              |

## 11. Open Questions

- Which external weather/FX providers will we integrate with (need API keys)?
- How do we handle daylight savings/timezone changes automatically?
- Should suggestions feature go into same table as settings or separate backlog table?
- Do we need UI/command to preview tomorrow’s digest on demand?

## 12. Engineering Backlog (High-Level)

1. Define DB migrations for `digest_settings` & suggestion log.
2. Implement `DigestSettingsRepository` + service Layer.
3. Build stub weather/FX module services (Effect-based).
4. Create `DigestModuleRegistry` & composition logic.
5. Integrate Redis producer/consumer (scheduler + worker) with Effect runtime.
6. Expose admin CLI/tool to requeue digests.
7. Add AI tools for digest configuration (toggle, weather, FX, suggestion).
8. Write integration tests for repository & module pipeline.
9. Update documentation (runbook, README digest section).
