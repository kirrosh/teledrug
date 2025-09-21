# PRD: Daily Digest – Weather & FX Modules

## 1. Background & Problem Statement
Our current morning digest only greets the user and optionally lists calendar events. Users have repeatedly asked for weather and currency exchange updates to plan their day. We need to extend the digest with these two modules, designing them in a way that is extensible for future modules and controllable per user.

## 2. Goals & Non-Goals
### Goals
1. Provide daily weather and FX information to every user in the morning digest.
2. Allow per-user configuration (e.g., weather location, units, FX currency pair) via our AI tools.
3. Keep the module architecture extensible so we can add additional digest blocks (news, tasks, etc.) later.
4. Use free-tier providers (no paid keys) initially; weather and FX data should be cacheable.
5. Ensure the digest run time remains acceptable; design in a way that can later be parallelized.

### Non-Goals
- Building a full preferences UI. Configuration happens via existing AI-tool interface.
- Supporting multiple providers simultaneously (v1 uses a single provider for each module). Provider switching can be added later.
- Real-time weather/FX updates outside the daily digest window.
- Integrating digest output into other channels (only Telegram for now).

## 3. Success Metrics
| Metric | Target |
| --- | --- |
| Daily digests containing weather and FX | 100% of digests sent |
| Users customizing settings | 30% within first month |
| Weather/FX fetch success rate | ≥ 95% (fallback to cached/last-known values) |
| Digest run time | < 5s average, < 20s P99 |

## 4. Personas & User Stories
### Persona: Mobile Professional
Wants quick glance of weather and currency rates each morning for commute and global meetings.

### User Stories
1. **As a user**, I receive today’s weather summary every morning with temperature and precipitation chance.
2. **As a user**, I receive today’s FX rate (e.g., USD/RUB) with daily change.
3. **As a user**, I can change my weather location via the assistant.
4. **As a user**, I can change my preferred FX currency pair via the assistant.
5. **As a user**, I can disable a module (e.g., turn off FX digest).

## 5. Functional Requirements
### 5.1 Module Architecture
- Introduce a `DigestModule` interface (Effect-based) that returns text + optional metadata (e.g., timestamp, provider). Modules can be executed sequentially for now but should not block each other indefinitely.
- Modules defined:
  1. **WeatherModule** – default provider: open-source API (e.g., Open-Meteo or OpenWeatherMap free tier).  
     - Inputs: location (city name or lat/lon), units (metric/imperial).  
     - Output: textual summary: temperature high/low, conditions, precipitation chance.  
     - Cache: store data for a given location/date for ~15 minutes to avoid repeated API calls.
  2. **FxModule** – provider: e.g., exchangerate.host (free API) or European Central Bank (ECB).  
     - Inputs: base currency, quote currency.  
     - Output: current rate and daily change.
- Each module is optional: digest builder checks module settings; if disabled or missing provider info, it outputs a note or nothing.

### 5.2 User Settings
- Extend database schema (new table `digest_modules_settings`):  
  - `user_id` (fk), `module` (enum: weather/fx/…), `enabled` (bool), `settings` (JSON), `updated_at`.  
  - For weather: `settings = { location: "Moscow", units: "metric" }`.  
  - For FX: `settings = { base: "USD", quote: "RUB" }`.
- `digest_settings` (existing/expanded) references module settings for quick access.
- Provide repository methods: `getDigestModulesSettings(userId)`, `updateDigestModuleSettings(userId, module, settings, enabled)`.
- AI tools update module settings:
  - `digest_set_weather(location, units?)`
  - `digest_set_fx(base, quote)`
  - `digest_enable_module(module)`, `digest_disable_module(module)`

### 5.3 Data Providers
- Weather: implement `WeatherProvider` abstraction with default implementation (`OpenMeteoProvider`). Should allow optional additional providers by config.  
  - Input: location string -> we call geocoding API or rely on user-supplied lat/lon (for v1, city name + API's built-in geocoding).  
  - Cache weather response in Redis or local in-memory (per job run). Considering cron runs once a day, a simple in-memory map per run is sufficient.
- FX: implement `FxProvider` with default provider `ExchangeRateHostProvider`. Cache responses for the day.
- Providers should be pure functions returning `Effect` to allow testability and caching.

### 5.4 Digest Composition
- `send-daily-greeting.ts` becomes `run-daily-digest.ts` (rename). The pipeline executes:
  1. Greeting text.
  2. Weather module (if enabled and provider data available).
  3. FX module (if enabled).
  4. Calendar events (existing logic).
- Resulting text example:  
  ```
  🌞 Доброе утро!

  🌤️ Москва: +5°C / −1°C, дождь 20%
  💱 USD/RUB = 92.34 (+0.15%)
  📅 События на сегодня:
  • 09:30–11:00 — Статус улучшений
  • 15:00–15:30 — Звонок с клиентом
  ```
- If a module fails (network error, invalid settings), log it and show fallback message: e.g., "⚠️ Не удалось получить данные погоды".

### 5.5 Extensibility
- `DigestModuleRegistry` – array of modules executed in order. Each module has: `id`, `isEnabled(userSettings)`, `fetch(userSettings) -> Effect<string>`.  
- Adding new module = implement provider and add to registry.

### 5.6 Performance & Caching
- Weather and FX providers should implement simple caching (e.g., Map keyed by `(location, date)` or `(pair, date)`) within the job run. Optionally extend to Redis if needed later.
- Calendar fetching should remain optimized (we already fetch once per user). Future iterations may run modules in parallel using `Effect.allPar` once we add concurrency controls.

### 5.7 Error Handling
- All modules must be resilient: log errors and return fallback text. Entire digest should proceed even if some module fails.
- Monitor provider response times; if a provider is down, mark module as temporarily unavailable.

## 6. Non-Functional Requirements
- **Reliability**: Failure of one module must not prevent others from running.
- **Scalability**: Architecture should support adding more modules (news, tasks) without major refactoring.
- **Config**: All required API keys/urls configurable via env (root or per app), with safe defaults for free providers.
- **Security**: Sensitive settings (API keys) never logged. Use encrypted storage for user-specific tokens.

## 7. Architecture Overview
```
DailyDigestJob
├─ GreetingModule (static)
├─ WeatherModule (WeatherProvider, caching)
├─ FxModule (FxProvider, caching)
├─ CalendarModule (existing Yandex integration)
└─ Compose text & send via Telegram API
```
Modules retrieve settings via `DigestSettingsRepository`; user edits go through AI tools invoking repository methods.

## 8. Providers (Initial)
- **Weather**: [Open-Meteo](https://open-meteo.com) — free, no auth required.  
  - Will use coordinates; minimal geocoding step (Open-Meteo Geocoding API).
- **FX**: [ExchangeRate.host](https://exchangerate.host) — free JSON API, no key required.
- Provide fallback text if provider unreachable.

## 9. Rollout Plan
1. Implement settings repository & schema changes for module configurations.
2. Implement provider clients (weather + FX) with caching.
3. Implement module registry and integrate into daily digest job.
4. Update AI tools to manage module settings and enable/disable modules.
5. QA: run digest manually for several users, validate output and error scenarios.
6. Deploy new cron; monitor logs; gather feedback.

## 10. Risks & Mitigations
| Risk | Mitigation |
| --- | --- |
| Providers rate-limit | Cache results; consider exponential backoff |
| Settings missing/incomplete | Provide defaults (e.g. fallback location/currency) and instruct user to configure |
| Slow provider responses | Add timeout; fall back to cached or last-known data |
| Future modules require different providers | Design digest registry to handle heterogenous data |

## 11. Open Questions
- Should users choose provider (e.g. OpenWeather vs other)? v1: no; single provider per module.
- How to nudge users to configure location/pair if defaults fail? Possibly auto-infer from profile/locale.
- Do we want summary metrics (e.g. "day planner" suggestions) combining modules? Out of scope for v1.

## 12. Engineering Backlog (High-Level)
1. Database migration for `digest_modules_settings` table.
2. `DigestSettingsRepository` + caching integration.
3. Weather provider client + module implementation.
4. FX provider client + module implementation.
5. Digest module registry & composition logic update.
6. Update cron job to use module registry and compose final message.
7. AI tools for managing module settings / toggles.
8. Logging & monitoring improvements.
9. Documentation updates (runbooks, README).
