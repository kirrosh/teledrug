# PRD: Journal, Tasks, Habits — Self-DB vs Notion

## 1) Overview & Goals
- Add three personal‑productivity features that complement the morning digest and calendar:
  - Evening Journal (EoD): capture short reflections, tags, and optional AI summary.
  - Tasks: natural‑language capture, listing, completion, planning (optional calendar slots).
  - Habits: recurring actions during the week, streaks, weekly goals.
- Support two storage strategies:
  1) Self‑hosted DB (Postgres via Drizzle) — fast, private, flexible.
  2) Notion Integration — leverage Notion databases/to‑do blocks and UI.
- Keep everything operable from Telegram chat and surfaced in the morning digest.

Success signals
- Faster morning focus (Top‑3 tasks, habit streaks, yesterday’s summary).
- Low friction capture via chat (NL → structured entries).
- Clean integration with existing Yandex Calendar for time‑blocks/alerts.

## 2) Features Summary
- Evening Journal
  - Capture short notes at day end (prompted by bot).
  - Optional tags; AI short summary for the digest.
  - Potential future: mood, highlights, ideas.
- Tasks
  - NL capture ("напомни завтра в 10 позвонить…"), due/time/duration parsing.
  - List Today / Overdue / This week; complete; optionally mirror to calendar.
  - Plan‑my‑day: find free slots, propose time blocks, create events on confirm.
- Habits
  - Weekly recurrence (days of week), simple logging, streaks and % completion.
  - Evening check‑in with quick buttons; weekly roll‑up in Sunday review.

---

## 3) Variant A — Self‑Hosted DB (Postgres)
Leverages existing stack: Drizzle ORM, Effect services, encrypted integrations.

Data model (proposed)
- journal_entries
  - id (pk), user_id (fk users.telegram_id)
  - date (date), text_raw (text)
  - tags (text[]), ai_summary (text), sentiment (int|null)
  - created_at, updated_at
  - indexes: (user_id, date)
- tasks
  - id (pk), user_id (fk), title (text), description (text|null)
  - due_at (timestamptz|null), duration_min (int|null), priority (int|null)
  - status (text: 'todo'|'done'|'cancelled'), tags (text[])
  - calendar_event_id (text|null) — link to external calendar event
  - created_at, updated_at
  - indexes: (user_id, due_at), (user_id, status)
- task_reminders
  - id (pk), task_id (fk), remind_at (timestamptz), sent_at (timestamptz|null)
  - indexes: (remind_at)
- habits
  - id (pk), user_id (fk), title (text), weekdays (int[]) — 1..7, goal_per_week (int)
  - active (bool), tags (text[]), created_at, updated_at
  - indexes: (user_id)
- habit_logs
  - id (pk), habit_id (fk), date (date), value (int|null)
  - indexes: (habit_id, date)

Services / Tools
- JournalRepository: addEntry(userId, entry), listRecent(userId, N)
- TaskRepository: add/complete/list(filter), schedule(taskId, start,duration)
- HabitRepository: addHabit, logHabit, listHabits, getProgress(week)
- AI Tools (via IntegrationRegistry):
  - addJournalEntry({ text, tags? }) → returns summary
  - addTask({ title, due?, time?, duration?, tags? })
  - completeTask({ id|titleLike })
  - listTasks({ scope: today|overdue|week })
  - planMyDay({ topN? }) → proposes time blocks, requires confirm to create events
  - addHabit({ title, days, goalPerWeek }) / logHabit({ id|title, date? })

Cron flows
- Morning digest: add 3 new modules (journal summary, tasks, habits)
  - Journal: last entry summary (ai_summary)
  - Tasks: Top‑3 today + overdue count
  - Habits: streaks + today’s checklist
- Evening journal ping (20:00–21:00): ask 2–3 prompts, save entry
- Reminder dispatcher (*/5min): send Telegram reminders for upcoming tasks (or rely on calendar VALARM, see below)
- Weekly review (Sun): roll‑up of tasks/habits + goals for next week

Calendar integration (Yandex Calendar)
- If task has specific time/duration → propose creating event via existing createEvent tool.
- Store calendar_event_id in tasks for traceability.
- Add VALARM in ICS to get device notifications (default 10–15 min before).

Digest integration points
- Add new digest modules next to weather/fx/calendar.
- Defaults controlled via DigestSettings (enable/disable, size limits).

Pros / Cons
- Pros: speed, privacy, flexible queries, no vendor limits, easy to evolve.
- Cons: you own reminders/UX, need minimal UIs for review (Telegram suffices for now).

---

## 4) Variant B — Notion Integration
Use Notion databases/to‑do blocks as the primary store; bot acts as a thin controller.

Data mapping
- Journal → Notion Database "Journal"
  - Properties: Date, Tags (multi‑select), Raw Text (rich text or page content), AI Summary (text)
  - Create page per day; write AI summary back into property
- Tasks → Notion Database "Tasks"
  - Title, Status (select: To Do / In Progress / Done), Due (date), Duration (number), Priority (number), Tags (multi‑select)
  - Option: store Calendar Event Id (text)
- Habits → Notion Database "Habits" + "Habit Logs"
  - Habits: Name, Weekdays (multi‑select), Goal/Week (number), Active (checkbox)
  - Habit Logs: Habit (relation), Date (date), Value (number)
- Alternative for habits/tasks: to_do blocks inside daily pages (support via block children API). Suitable for small lists; DBs are better for queries/progress.

Bot actions → Notion API
- addJournalEntry → create Journal page; attach tags; compute AI summary; update property
- addTask → create Tasks page with parsed due/time/duration
- completeTask → set Status = Done or check to_do block
- listTasks(today) → query database: Due is today AND Status != Done → format list
- planMyDay → read tasks + user calendar, propose time blocks; on confirm, call Yandex createEvent and update Notion task with event id
- addHabit/logHabit → create habit or append log (relation)

Digest using Notion
- Query: last Journal page (by Date desc) → summary snippet
- Tasks today (limit N), overdue count
- Habits progress: computed from Habit Logs vs target
- Provide Notion page links in messages (optional)

Operational notes
- Auth: Notion integration token per user (store encrypted in user_integrations). User must share databases with the integration.
- API limits: throttle (e.g., 3 req/s) and cache queries in memory for a run.
- Data shape stability: define required properties and fail gracefully if missing.

Pros / Cons
- Pros: rich UI, mobile apps, checklists, views/filters, low infra overhead.
- Cons: rate limits, API gaps, vendor lock‑in, slower queries than local DB.

---

## 5) Chat UX Patterns
- NL capture → tool calls with confirmations for destructive or calendaring actions.
- Quick buttons:
  - From task list: "✅ Готово"; from plan: "🗓 Создать слот 10:00–10:45"
  - From habits: "☑️ Выполнено" for today
- Journal prompts (evening): 2–3 short questions; summary shown instantly.

---

## 6) Security & Privacy
- Store third‑party tokens encrypted (already supported via EncryptionService + user_integrations table).
- Don’t log sensitive content; redact tokens; respect chat privacy.
- For Notion: warn user which DBs must be shared with the integration.

---

## 7) Minimal Implementation Plan
Iteration 1 (Self‑DB first)
- Migrations: journal_entries, tasks, task_reminders
- Tools: addJournalEntry, addTask/completeTask/listToday, planMyDay (proposal only)
- Digest: add tasks + journal summary modules

Iteration 2
- Migrations: habits, habit_logs; tools addHabit/logHabit/listHabits
- Crons: evening journal ping; reminders dispatcher; weekly review
- Calendar: add VALARM support in createEvent

Iteration 3 (Notion option)
- NotionIntegration: auth + basic DB mapping; tasks/journal/habits tools backed by Notion
- Feature flag to switch storage per user (Self‑DB vs Notion)

---

## 8) Integration Points in Codebase
- Digest modules: `packages/core/src/effect/digest/modules`
- Digest settings: `packages/core/src/effect/services/digest-settings.ts`
- Cron: `packages/core/src/effect/cron`
- Tools registry: `packages/core/src/effect/services/integration-registry.ts`
- Yandex Calendar tools: `packages/core/src/effect/integrations/yandex-calendar`

Notes
- Tasks with precise time/duration → suggest calendar event creation; store link.
- Morning digest limits: keep each block concise (configurable N).
- Graceful failure: log and continue; always produce a useful digest message.
