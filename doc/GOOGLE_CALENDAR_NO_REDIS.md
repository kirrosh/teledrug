# Google Calendar Integration: PostgreSQL вместо Redis

## Изменения

**Вместо Redis для OAuth сессий теперь используется PostgreSQL!**

### ✅ Преимущества:

1. **Нет дополнительных зависимостей** - используем только PostgreSQL
2. **Проще development** - не нужно запускать Redis локально
3. **Проще deployment** - один сервис вместо двух
4. **Автоматическая очистка** - expired sessions удаляются каждый час
5. **Меньше moving parts** - проще поддерживать

### 🔧 Что изменилось:

#### 1. Новая таблица `oauth_sessions`

```sql
CREATE TABLE oauth_sessions (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL,
  provider VARCHAR(50) NOT NULL,
  state VARCHAR(128) NOT NULL,
  code_verifier VARCHAR(128) NOT NULL,
  metadata JSONB,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_oauth_sessions_session_id ON oauth_sessions(session_id);
CREATE INDEX idx_oauth_sessions_expires_at ON oauth_sessions(expires_at);
```

#### 2. Файлы

**Удалено:**
- ❌ `packages/api/src/utils/redis.ts`

**Создано:**
- ✅ `packages/api/src/utils/sessions.ts` - PostgreSQL session storage

**Изменено:**
- ✅ `packages/api/src/routes/oauth-google.ts` - использует sessions вместо redis
- ✅ `packages/api/src/index.ts` - убран closeRedis, добавлен cleanup task
- ✅ `packages/db/src/schema.ts` - добавлена таблица oauth_sessions

#### 3. Environment Variables

**Удалено:**
```bash
REDIS_URL=redis://localhost:6379  # Больше не нужно!
```

**Осталось:**
```bash
DATABASE_URL=postgresql://...  # Используется для всего
```

### 🚀 Quick Start (обновленный)

```bash
# 1. Настройте Google Cloud Console (без изменений)

# 2. Добавьте в .env:
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth/google/callback
API_URL=http://localhost:3001
DATABASE_URL=postgresql://user:pass@localhost:5432/teledrug

# 3. Запустите миграции
npm run db:migrate

# 4. Запустите API (Terminal 1)
npm run api:dev

# 5. Запустите Bot (Terminal 2)
npm run bot:dev

# 6. В Telegram:
/connect_google
```

**Больше не нужно:**
```bash
# ❌ Это больше не требуется!
docker run -d -p 6379:6379 redis:alpine
```

### 📊 Сравнение

| Аспект | Redis (старое) | PostgreSQL (новое) |
|--------|----------------|-------------------|
| **Зависимости** | PostgreSQL + Redis | Только PostgreSQL |
| **Local dev** | Нужен Docker/Redis | Ничего дополнительного |
| **Production** | 2 сервиса | 1 сервис |
| **Cleanup** | TTL автоматический | Cron каждый час |
| **Сложность** | Выше | Ниже |
| **Стоимость** | Два сервиса | Один сервис |

### 🔄 Migration Guide

Если вы уже установили старую версию с Redis:

1. Запустите миграцию:
   ```bash
   npm run db:migrate
   ```

2. Удалите Redis из `.env`:
   ```bash
   # Удалите эту строку:
   REDIS_URL=redis://localhost:6379
   ```

3. Перезапустите API server:
   ```bash
   npm run api:dev
   ```

4. (Опционально) Остановите Redis:
   ```bash
   docker stop teledrug-redis
   docker rm teledrug-redis
   ```

### 🧹 Автоматическая очистка

API server автоматически удаляет expired сессии каждый час:

```typescript
// Cleanup expired sessions every hour
setInterval(async () => {
  const deleted = await cleanupExpiredSessions();
  if (deleted > 0) {
    console.log(`🧹 Cleaned up ${deleted} expired OAuth session(s)`);
  }
}, 60 * 60 * 1000); // 1 hour
```

### 🏗️ Architecture (обновленная)

```
┌────────────────────────────────────────────┐
│          TeleDrug Application               │
│                                             │
│  ┌──────────────┐    ┌──────────────┐     │
│  │ Telegram Bot │    │  API Server  │     │
│  │  (Grammy)    │    │  (Express)   │     │
│  └──────┬───────┘    └──────┬───────┘     │
│         │                    │              │
│         └────────┬───────────┘              │
│                  │                          │
│                  ↓                          │
│         ┌─────────────────┐                │
│         │   PostgreSQL    │                │
│         │                 │                │
│         │ - Users         │                │
│         │ - Integrations  │                │
│         │ - OAuth Sessions│ ← NEW!        │
│         │ - Tasks         │                │
│         └─────────────────┘                │
│                                             │
└────────────────────────────────────────────┘

❌ Redis больше не нужен!
```

### 📝 Обновленная документация

Все документы обновлены:
- ✅ Setup Guide - убраны инструкции по Redis
- ✅ Quick Start - упрощен процесс запуска
- ✅ README - обновлены требования

### ⚡ Performance

PostgreSQL более чем достаточно для OAuth сессий:
- Сессии живут всего 10 минут
- Максимум несколько сессий одновременно
- Index по session_id обеспечивает быстрый поиск
- Автоматическая очистка предотвращает переполнение

### 🎯 Итого

**Упрощенная архитектура:**
- ✅ Меньше зависимостей
- ✅ Проще setup
- ✅ Дешевле в production
- ✅ Проще поддержка

**Без потери функциональности:**
- ✅ OAuth flow работает идентично
- ✅ Security не пострадал
- ✅ Performance достаточный

---

**Ready to use!** 🚀 PostgreSQL заменил Redis полностью.
