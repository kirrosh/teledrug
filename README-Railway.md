# Railway Development Guide для Teledrug

## Настройка деплоя на Railway

### 1. Создание проекта
1. Зарегистрируйтесь на [Railway.app](https://railway.app)
2. Создайте новый проект
3. Подключите ваш GitHub репозиторий

### 2. Добавление PostgreSQL
1. В проекте нажмите `+ New` или используйте `Ctrl/Cmd + K`
2. Выберите `PostgreSQL` из списка доступных сервисов
3. Railway автоматически создаст PostgreSQL инстанс

### 3. Настройка переменных окружения

#### Для основного сервиса (Telegram Bot):
Перейдите в настройки сервиса → Variables и добавьте:

```
TELEGRAM_BOT_TOKEN=ваш_токен_telegram_бота
OPENAI_API_KEY=ваш_api_ключ_openai
ENCRYPTION_MASTER_KEY=64_символьный_hex_ключ
DATABASE_URL=${{ Postgres.DATABASE_URL }}
NODE_ENV=production
```

#### Ключевые переменные окружения:
- `TELEGRAM_BOT_TOKEN` - токен Telegram бота (получить у @BotFather)
- `OPENAI_API_KEY` - API ключ OpenAI
- `ENCRYPTION_MASTER_KEY` - 64-символьный hex ключ для шифрования
- `DATABASE_URL` - автоматически берется из PostgreSQL сервиса

### 4. Конфигурация Railway
В проекте уже настроен файл `railway.toml` с базовой конфигурацией:
- Используется Nixpacks builder
- Настроен health check
- Политика перезапуска: always

### 5. Деплой
После настройки переменных:
1. Railway автоматически запустит деплой при изменениях в main ветке
2. Проверьте логи деплоя в Railway dashboard
3. Убедитесь что бот запустился без ошибок

### 6. Мониторинг
- Следите за логами в Railway dashboard
- PostgreSQL метрики доступны во вкладке PostgreSQL сервиса
- Настройте уведомления о статусе деплоя

### 7. База данных
Migrations будут автоматически применены при запуске приложения.
Для ручного управления БД используйте:
```bash
bun run db:generate  # генерация миграций
bun run db:migrate   # применение миграций
bun run db:studio    # Drizzle Studio для работы с БД
```

### Troubleshooting
1. Если бот не отвечает - проверьте логи и переменные окружения
2. Если проблемы с БД - убедитесь что DATABASE_URL правильно настроен
3. При ошибках шифрования - проверьте ENCRYPTION_MASTER_KEY

### Стоимость
- PostgreSQL: бесплатно до 100MB
- Приложение: бесплатно до $5/месяц ресурсов
- Network egress при использовании TCP Proxy оплачивается отдельно