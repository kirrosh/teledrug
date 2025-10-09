# Calendar & Tasks Regression Analysis

## Reported Behaviour
- Single user confirmation message (`"Записался на чистку. Сегодня иду в 18 30"`) produced two calendar events and left the related task open.
- Telegram confirmation text showed `15:30–16:00`, while the calendar UI displayed the correct `18:30` slot.
- Expectation: close the pending task “Запись на чистку зубов”, create **one** calendar entry with correct time, and format the chat reply accurately.

## Findings
- **Conversation history loses speaker roles.** `MessageHistory.getHistory` (`packages/core/src/effect/services/message-history.ts:58`) returns plain strings. `buildMessages` (`packages/core/src/effect/services/ai-agent.ts:346`) reassigns roles by index, so the most recent assistant prompt (task list) is replayed as a “user” message. Calendar agent then interprets checklist items as fresh requests, triggering duplicate `createEvent` calls and preventing tasks routing.
- **Router prompt lacks guidance for completion intents.** `routeAgents`’ system rules only cover creating or listing tasks, not closing them, making it easy for the model to pick calendar only.
- **Calendar result formatter ignores user timezone.** `formatCreateEventResult` (`packages/core/src/effect/integrations/yandex-calendar/index.ts:628`) formats start/end with `toLocaleTimeString` in the server timezone (likely UTC), hence the 3-hour drift in Telegram.
- **History always injected.** Even when the user does not reference previous bot output, we replay the backlog, which amplifies the role mislabel issue and confuses routing.

## Implementation Plan

### 1. Conversation History Pipeline
- Change `MessageHistory.getHistory`/`getRecentHistory` to return `{ role, content, timestamp }` (they already store this internally) and update the few call sites (`telegram-client`, tests).
- Refactor `buildMessages` to honour real roles and strip duplicates. Ensure we cap to the last N exchanges only when allowed.
- Делегировать решение об использовании истории самому LLM: передавать роль-тегированные сообщения и давать явную инструкцию игнорировать прошлый диалог, если пользователь не ссылается на него прямо.
- Optional: surface the last assistant message type in history (tag for “task list” vs. “calendar summary”) to support smarter heuristics later.

### 2. Router & Agent Prompt Updates
- Extend routing instructions in `routeAgents` (`packages/core/src/effect/services/ai-agent.ts:413`) with a rule like “Если пользователь сообщает о выполнении, переносе или отмене задачи — добавь агента tasks.”
- Update the calendar system prompt to cap creations (“Создавай не более одного события на сообщение, если явно не просят несколько”) and require timezone-aware ISO strings (`YYYY-MM-DDTHH:mm:ss±HH:MM`).
- Consider a defensive guard inside the Yandex calendar tool wrapper: latch the first successful `createEvent` execution and reject subsequent calls within the same agent run with a friendly error to discourage duplicates.

### 3. Calendar Formatting & Time Handling
- Pass user locale/timezone from `IntegrationRegistry` into `YandexCalendarIntegration.createTools` (hook in `userSettings` gathered in `integration-registry.ts:146`).
- Use that timezone in both ICS generation defaults (when LLM omits offsets) and in `formatCreateEventResult`/`formatEventCard` to render times aligned with the user.
- If start/end arrive without offsets, normalise them using the user timezone before serialising to UTC for CalDAV.

### 4. Test Coverage
- **Unit:** добавить проверки на корректную нормализацию истории (`buildMessages` + `normalizeHistory`), чтобы роли сохранялись, а сообщения передавались LLM в нужном порядке.
- **Integration (LLM harness):** craft a scenario with stubbed tools where history includes a TeleDrug task digest followed by the user confirmation. Assert that:
  1. Router selects both `tasks` and `calendar`.
  2. `manageTasks` receives a `complete` entry for the matching task id.
  3. `createEvent` executes exactly once.
- **Unit:** cover `formatCreateEventResult` with injected timezone to ensure the rendered time matches expected local time.
- **Regression guard:** ensure multiple calendar tool invocations in one execution are rejected/ignored.

## Open Questions / Follow-ups
- Оценивать, справляется ли LLM с выбором релевантной истории без доп. подсказок; при необходимости усиливать системные инструкции вместо добавления эвристик.
- Decide whether to persist additional metadata (e.g., message kind) in `MessageHistory` to support richer prompts.
- Validate that CalDAV accepts timezone-normalised values when the user sends offset-less timestamps; adjust prompt/validation if not.
