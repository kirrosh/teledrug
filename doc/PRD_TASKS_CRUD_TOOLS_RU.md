# PRD — Инструменты управления задачами (CRUD) в чате

## 1. Назначение
Документ описывает набор чат‑инструментов (AI tools) и UX‑паттернов для полноценного управления задачами в TeleDrug: создание, просмотр, завершение, перенос сроков, удаление и редактирование. Функциональность реализуется на текущем стеке (Effect, Drizzle/Postgres, Telegram, AI SDK) и интегрируется с дневником и утренним дайджестом.

## 2. Цели
- CRUD для задач целиком из чата.
- Естественные фразы → надёжные вызовы инструментов с разруливанием неоднозначностей.
- Минимальная схема данных (id, userId, title, status, dueAt, timestamps).
- Короткие действия через инлайн‑кнопки (Complete / Reschedule / Delete).

## 3. Юзкейсы (примеры)
- «Создай задачу: оплатить счет до пятницы» → task_add(title, dueAt)
- «Покажи мои задачи» → task_list(scope: open|today|overdue|week)
- «Сделай задачу ‘зубной’ выполненной» → task_complete(titleLike)
- «Перенеси ‘зубной’ на следующую неделю» → task_reschedule(titleLike, shift)
- «Переименуй ‘зубной’ → ‘Стоматолог’» → task_update(set.title)
- «Отмени ‘зубной’» → task_update(set.status='cancelled') или task_delete
- «Удалить задачу ‘зубной’» → task_delete(titleLike)

## 4. Инструменты (AI Tools)
- task_add
  - input: { title: string, dueAt?: string(ISO) }
  - output: { id, title }
- task_list
  - input: { scope: 'open'|'today'|'overdue'|'week', limit?: number }
  - output: { items: [{ id, title, dueAt? }], scope }
- task_complete
  - input: { id?: number, titleLike?: string }
  - output: { ok: boolean, id }
- task_delete
  - input: { id?: number, titleLike?: string }
  - output: { ok: boolean, id }
- task_update
  - input: { id?: number, titleLike?: string, set: { title?: string, dueAt?: string(ISO), status?: 'todo'|'done'|'cancelled' } }
  - output: { id, title, dueAt?, status }
- task_reschedule
  - input: { id?: number, titleLike?: string, shift: 'today'|'tomorrow'|'next_week'|'+Ndays' }
  - поведение: переводит в конкретную дату и зовёт task_update
- task_search (опционально)
  - input: { query: string, limit?: number }
  - output: { items: [{ id, title, dueAt? }] }

Принципы:
- Если указано id — никаких дизамбигуаций.
- Если только titleLike — при множественных совпадениях вернуть список на выбор (до N, иначе сузить запрос).

## 5. Репозиторий (Effect services) — дополнения
- TaskRepository
  - findById(userId, id)
  - findByTitleLike(userId, query, limit): [{ id, title, dueAt, status }]
  - update(userId, id, patch)
  - delete(userId, id)
  - listOpen(userId, limit)
  - listForToday(userId, limit) — уже есть (включает undated)
  - countOverdue(userId)

Хелперы:
- resolveByIdOrTitleLike(userId, { id?, titleLike? }) → One | Many | None
- parseRelativeShift('next_week'|'+2days'|...) → ISO‑дата

## 6. UX в Telegram (кнопки)
- Вывод списков задач (listTasks): строки вида
  - «• 15:00 — Позвонить врачу» или «• Позвонить врачу» (без даты)
  - Кнопки справа: [✅ Готово] [🗓 Срок] [🗑 Удалить]
- Быстрое изменение срока («🗓 Срок»): панель пресетов
  - Today / Tomorrow / Next Mon / +2d / Снять срок → callback с YMD
- Дизамбигуация по titleLike
  - «Нашёл несколько задач. Выберите:» список с [#id title] → нажатие подставляет id и повторяет действие.

Формат callback_data (безопасный и короткий):
- task:complete:<id>
- task:delete:<id>
- task:update:due:<id>:<YYYYMMDD|0>
- task:select:<id>:<action>

## 7. Парсинг дат
- По умолчанию — LLM в агенте нормализует NL‑дату до ISO.
- На стороне сервера — быстрые пресеты:
  - today/tomorrow
  - next_week → ближайший понедельник
  - +Ndays → текущая дата + N
- Валидируем: dueAt = начало локального дня; не ставим прошлые даты без явного намерения.

## 8. Ошибки и неоднозначности
- Несколько совпадений: вернуть список для выбора + подсказка уточнить.
- Нет совпадений: дружелюбное сообщение + предложение создать новую задачу.
- Ограничение длины callback_data: использовать короткие коды (id, ymd); избегать передачи title в callback.

## 9. Схема БД (минимум)
- tasks(id, user_id, title, status, due_at, created_at, updated_at)
- status: 'todo'|'done'|'cancelled' (проверяется на уровне инструментов)
- Никаких напоминаний/календаря в этой итерации.

## 10. Итерации внедрения
- Итерация A (минимум)
  - Добавить: task_complete, task_delete, task_update(title, dueAt, status), расширить task_list (open|week), task_reschedule.
  - Репозиторий: методы update/delete/findByTitleLike + дизамбиг.
  - Кнопки: Complete/Delete/Set due для listTasks.
- Итерация B
  - task_search, «Создать все» из предложений дневника, «Отменить все просроченные» (массовые операции с подтверждением).
- Итерация C
  - Интеграция с календарём (создание событий), напоминания.

## 11. Тест‑кейсы (ручные)
- Создание без даты → list open/today включает задачу.
- Создание с датой → list today/overdue/weekly.
- Завершение/Удаление по id и по titleLike (с дизамбигуацией).
- Обновление title/dueAt/status.
- Перенос срока пресетами (кнопки) и относительными фразами.

## 12. Примеры NL → Tools
- «Покажи все задачи на неделю» → task_list({ scope: 'week' })
- «Закрой задачу ‘зубной’» → task_complete({ titleLike: 'зубной' })
- «Удалить задачу #12» → task_delete({ id: 12 })
- «Перенеси встречу на завтра» → task_reschedule({ titleLike: 'встречу', shift: 'tomorrow' })
- «Поменяй срок ‘счёт’ на +2 дня» → task_reschedule({ titleLike: 'счёт', shift: '+2days' })
- «Переименуй ‘счёт’ → ‘Оплатить счёт МТС’» → task_update({ titleLike: 'счёт', set: { title: 'Оплатить счёт МТС' } })

## 13. Нефункциональные
- Прозрачные ошибки: человекочитаемые сообщения.
- Идемпотентность кнопок: повторный клик не должен ломать состояние.
- Логи: create/update/delete/reschedule с userId и taskId.

## 14. Замечания по безопасности
- Не передавать содержимое title в callback_data (только id/ymd).
- Валидация userId при действиях.
- Санитизация title на вывод (экранировать Markdown‑символы).

