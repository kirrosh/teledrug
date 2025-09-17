# PRD: Система хранения пользовательских настроек и интеграций

## 1. Обзор проекта

### Текущая ситуация

- **Проблема**: Конфигурация календаря (Яндекс) захардкожена в коде (`src/index.ts:18-22`)
- **Ограничение**: Все пользователи используют одну и ту же учетную запись календаря
- **Безопасность**: Пароли хранятся открытым текстом в коде
- **Масштабирование**: Невозможно добавить индивидуальные интеграции для каждого пользователя

### Цель

Реализовать систему безопасного хранения и управления пользовательскими настройками интеграций через Telegram бот.

## 2. Анализ возможностей Telegram

### CloudStorage (Mini Apps)

- **Ограничения**: Доступен только для Mini Apps, не для обычных ботов
- **Вместимость**: До 1024 элементов на пользователя
- **Вывод**: Не подходит для нашего случая (обычный бот без Mini App)

### Решение для ботов

Telegram Bot API не предоставляет встроенное хранилище данных. Необходима внешняя БД.

## 3. Архитектура решения

### 3.1 Выбор БД

#### Рекомендуемый вариант: PostgreSQL

**Преимущества:**

- Надежность и проверенность временем
- Отличная поддержка JSON для гибкой схемы интеграций
- Встроенное шифрование на уровне полей
- Поддержка в Bun через `Bun.sql`

**Схема БД:**

```sql
CREATE TABLE users (
    telegram_id BIGINT PRIMARY KEY,
    username VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_integrations (
    id SERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
    integration_type VARCHAR(50) NOT NULL,
    credentials_encrypted TEXT NOT NULL, -- Зашифрованный JSON
    settings JSONB,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, integration_type)
);

CREATE INDEX idx_user_integrations_user_id ON user_integrations(user_id);
```

#### Альтернатива: MongoDB

**Преимущества:**

- Гибкая схема документов
- Простота работы с JSON-подобными структурами

**Недостатки:**

- Больше накладных расходов для простых случаев
- Требует дополнительной настройки шифрования

### 3.2 Шифрование данных

#### Двустороннее шифрование (AES-256-GCM)

```typescript
// src/security/encryption.ts
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

export class EncryptionService {
  private readonly algorithm = "aes-256-gcm";
  private readonly key: Buffer;

  constructor() {
    // Ключ из переменной окружения
    const masterKey = process.env.ENCRYPTION_MASTER_KEY;
    if (!masterKey || masterKey.length !== 64) {
      throw new Error("Invalid encryption key");
    }
    this.key = Buffer.from(masterKey, "hex");
  }

  encrypt(text: string): { encrypted: string; iv: string; tag: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    const tag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString("hex"),
      tag: tag.toString("hex"),
    };
  }

  decrypt(encrypted: string, iv: string, tag: string): string {
    const decipher = createDecipheriv(
      this.algorithm,
      this.key,
      Buffer.from(iv, "hex")
    );

    decipher.setAuthTag(Buffer.from(tag, "hex"));

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }
}
```

### 3.3 Управление интеграциями через бота

#### Новые команды бота

1. **`/add_yandex_calendar`** - Добавление календаря Яндекса

   ```
   Пользователь: /add_yandex_calendar
   Бот: Введите URL календаря CalDAV
   Пользователь: https://caldav.yandex.ru/calendars/koshelevkirill1992%40yandex.ru/events-5649327/
   email учетной записи берем из url
   Бот: Введите пароль приложения
   Пользователь: ****
   Бот: ✅ Календарь успешно подключен!
   ```

2. **`/integrations`** - Список интеграций (уже существует)

3. **`/remove_yandex_calendar`** - Удаление интеграции

4. \*\*`/test_yandex_calendar`- Проверка работоспособности

#### Реализация добавления календаря

```typescript
// src/telegram/handlers/calendar-setup.ts
export class CalendarSetupHandler {
  private setupSessions = new Map<number, SetupSession>();

  async handleAddCalendar(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Начинаем сессию настройки
    this.setupSessions.set(userId, {
      step: "url",
      data: {},
    });

    await ctx.reply(
      "📅 Настройка календаря Яндекс\n\n" +
        "Шаг 1/3: Введите URL вашего календаря CalDAV\n" +
        "Пример: https://caldav.yandex.ru/calendars/username/events-xxx/\n\n" +
        "Для отмены введите /cancel"
    );
  }

  async handleUserMessage(ctx: Context, text: string) {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const session = this.setupSessions.get(userId);
    if (!session) return false;

    if (text === "/cancel") {
      this.setupSessions.delete(userId);
      await ctx.reply("❌ Настройка отменена");
      return true;
    }

    switch (session.step) {
      case "url":
        if (!this.validateCalDAVUrl(text)) {
          await ctx.reply("❌ Неверный формат URL. Попробуйте еще раз.");
          return true;
        }
        session.data.url = text;
        session.step = "username";
        await ctx.reply("Шаг 2/3: Введите email вашей учетной записи Яндекс");
        break;

      case "username":
        if (!this.validateEmail(text)) {
          await ctx.reply("❌ Неверный формат email. Попробуйте еще раз.");
          return true;
        }
        session.data.username = text;
        session.step = "password";
        await ctx.reply(
          "Шаг 3/3: Введите пароль приложения\n" +
            "⚠️ Используйте пароль приложения, не основной пароль!\n" +
            "Создать: https://id.yandex.ru/security/app-passwords"
        );
        break;

      case "password":
        session.data.password = text;

        // Удаляем сообщение с паролем из чата
        await ctx.deleteMessage();

        // Проверяем подключение
        const isValid = await this.testConnection(session.data);

        if (isValid) {
          // Сохраняем в БД
          await this.saveIntegration(userId, session.data);
          await ctx.reply(
            "✅ Календарь успешно подключен!\n" +
              "Теперь я могу работать с вашими событиями."
          );
        } else {
          await ctx.reply(
            "❌ Не удалось подключиться к календарю.\n" +
              "Проверьте правильность данных и попробуйте еще раз.\n" +
              "Используйте /add_calendar для повторной настройки."
          );
        }

        this.setupSessions.delete(userId);
        break;
    }

    return true;
  }
}
```

## 4. План миграции

### Фаза 1: Подготовка инфраструктуры

1. Развернуть PostgreSQL (локально/облако)
2. Создать схему БД
3. Настроить переменные окружения:
   ```env
   DATABASE_URL=postgresql://user:pass@host:5432/teledrug
   ENCRYPTION_MASTER_KEY=<64-символьный hex ключ>
   ```

### Фаза 2: Реализация базового функционала

1. Создать сервис шифрования
2. Создать репозиторий для работы с БД
3. Модифицировать `UserConfigStorage` для работы с БД
4. Реализовать обработчик `/add_yandex_calendar`

### Фаза 3: Миграция существующих пользователей

1. При первом запуске проверять наличие пользователя в БД
2. Если нет - предложить настроить интеграции
3. Удалить захардкоженные credentials из кода

### Фаза 4: Расширение функционала

1. Добавить другие типы интеграций
2. Реализовать импорт/экспорт настроек
3. Добавить возможность множественных календарей

## 5. Безопасность

### Требования

1. **Шифрование**: Все credentials хранятся в зашифрованном виде
2. **Ключи**: Мастер-ключ хранится в переменных окружения
3. **Аудит**: Логирование всех операций с credentials
4. **Удаление сообщений**: Автоматическое удаление сообщений с паролями
5. **Валидация**: Проверка формата всех вводимых данных
6. **Rate limiting**: Ограничение попыток настройки интеграций

### Дополнительные меры

- Использование Telegram user_id как primary key (не username)
- Регулярная ротация мастер-ключа
- Backup зашифрованных данных

## 6. Технические детали

### Зависимости

```json
{
  "dependencies": {
    "bun:sqlite": "для локальной разработки",
    "postgres": "для продакшена (через Bun.sql)",
    "crypto": "встроенный модуль для шифрования"
  }
}
```

### Структура файлов

```
src/
├── storage/
│   ├── database/
│   │   ├── client.ts         # Клиент БД
│   │   ├── migrations/       # SQL миграции
│   │   └── repositories/     # Репозитории
│   ├── encryption/
│   │   └── service.ts        # Сервис шифрования
│   └── user-config.ts        # Модифицированный storage
├── telegram/
│   ├── handlers/
│   │   └── calendar-setup.ts # Обработчик настройки
│   └── bot.ts                # Модифицированный бот
└── config/
    └── database.ts           # Конфигурация БД
```

## 7. Метрики успеха

1. **Функциональность**: 100% пользователей могут настроить свой календарь
2. **Безопасность**: 0 утечек credentials
3. **UX**: Настройка за < 2 минуты
4. **Надежность**: 99.9% uptime интеграций

## 8. Риски и митигации

| Риск                         | Вероятность | Митигация                                |
| ---------------------------- | ----------- | ---------------------------------------- |
| Утечка мастер-ключа          | Низкая      | Использование secret management, ротация |
| Потеря данных                | Средняя     | Регулярные backup, репликация БД         |
| Ошибки при вводе credentials | Высокая     | Валидация, тестовое подключение          |
| Перегрузка БД                | Низкая      | Индексы, connection pooling              |

## 9. Будущие улучшения

1. **OAuth 2.0**: Интеграция через OAuth вместо паролей
2. **Multi-factor**: Дополнительная защита для критичных операций
3. **Федерация**: Поддержка множественных календарных систем
4. **UI**: Mini App для визуальной настройки
5. **Экспорт**: Возможность экспорта/импорта конфигураций

## 10. Заключение

Предложенная архитектура решает текущие проблемы безопасности и масштабирования, обеспечивая:

- Безопасное хранение credentials каждого пользователя
- Простой процесс настройки через чат
- Возможность добавления новых типов интеграций
- Соответствие best practices по безопасности

Рекомендуется начать с PostgreSQL и базового функционала, постепенно расширяя возможности системы.
