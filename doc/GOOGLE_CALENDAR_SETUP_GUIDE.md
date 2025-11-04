# Google Calendar Integration: Setup Guide

Пошаговая инструкция по настройке и запуску Google Calendar интеграции.

## Prerequisite

Убедитесь, что у вас установлено:

- ✅ Node.js 18+ или Bun
- ✅ PostgreSQL
- ✅ Redis
- ✅ Telegram Bot Token

## Step 1: Настройка Google Cloud Console (10 минут)

### 1.1 Создайте проект

1. Перейдите на https://console.cloud.google.com/
2. Нажмите "Select a project" → "New Project"
3. Введите название: `TeleDrug`
4. Нажмите "Create"

### 1.2 Включите Google Calendar API

1. В меню слева выберите **APIs & Services** → **Library**
2. Найдите "Google Calendar API"
3. Нажмите на карточку
4. Нажмите **Enable**

### 1.3 Настройте OAuth Consent Screen

1. **APIs & Services** → **OAuth consent screen**
2. User Type: выберите **External**
3. Нажмите **Create**

4. Заполните форму:
   - **App name**: `TeleDrug`
   - **User support email**: ваш email
   - **Developer contact information**: ваш email
   - Нажмите **Save and Continue**

5. **Scopes**:
   - Нажмите **Add or Remove Scopes**
   - Найдите и добавьте:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/calendar.readonly`
   - Нажмите **Update** → **Save and Continue**

6. **Test users** (для development):
   - Нажмите **Add Users**
   - Добавьте ваш Google email
   - Нажмите **Save and Continue**

7. Нажмите **Back to Dashboard**

### 1.4 Создайте OAuth 2.0 Credentials

1. **APIs & Services** → **Credentials**
2. Нажмите **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `TeleDrug OAuth Client`

5. **Authorized redirect URIs**:
   - Для development:
     ```
     http://localhost:3001/oauth/google/callback
     ```
   - Для production (добавить позже):
     ```
     https://your-domain.com/oauth/google/callback
     ```

6. Нажмите **Create**

7. **Важно!** Скопируйте и сохраните:
   - **Client ID**: `xxxxx.apps.googleusercontent.com`
   - **Client Secret**: `GOCSPX-xxxxx`

## Step 2: Установка зависимостей (2 минуты)

```bash
# Из корня проекта
cd /Users/kirrotech/Projects/teledrug

# Установить зависимости для нового пакета API
cd packages/api
npm install

# Вернуться в корень
cd ../..

# Установить все зависимости workspace
npm install
```

## Step 3: Настройка Environment Variables (5 минут)

### 3.1 Обновите `.env` в корне проекта

Добавьте следующие переменные в `.env`:

```bash
# Google OAuth 2.0
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth/google/callback

# API Server
API_URL=http://localhost:3001
API_PORT=3001

# Redis (для OAuth sessions)
REDIS_URL=redis://localhost:6379
```

Замените `xxxxx` на ваши реальные значения из Google Cloud Console.

### 3.2 Проверьте другие переменные

Убедитесь, что в `.env` есть:

```bash
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/teledrug_db

# Encryption
ENCRYPTION_MASTER_KEY=your_64_character_hex_key
```

## Step 4: Запуск Redis (2 минуты)

OAuth сессии хранятся в Redis. Запустите Redis:

### Вариант A: Docker (рекомендуется)

```bash
docker run -d \
  --name teledrug-redis \
  -p 6379:6379 \
  redis:alpine
```

### Вариант B: Homebrew (macOS)

```bash
brew install redis
brew services start redis
```

### Вариант C: apt (Linux)

```bash
sudo apt install redis-server
sudo systemctl start redis
```

### Проверка

```bash
redis-cli ping
# Должно вернуть: PONG
```

## Step 5: Запуск приложения (3 минуты)

### 5.1 Запустите API Server

Откройте **новый терминал** и запустите:

```bash
cd /Users/kirrotech/Projects/teledrug
npm run api:dev
```

Вы должны увидеть:

```
✅ Redis connected
🚀 API server running on port 3001
📍 OAuth endpoints:
   - Start: http://localhost:3001/oauth/google/start
   - Callback: http://localhost:3001/oauth/google/callback
   - Success: http://localhost:3001/oauth/google/success
   - Error: http://localhost:3001/oauth/google/error
```

### 5.2 Запустите Telegram Bot

Откройте **еще один терминал** и запустите бота:

```bash
cd /Users/kirrotech/Projects/teledrug
npm run bot:dev
```

### 5.3 Проверьте Health Check

В браузере откройте:

```
http://localhost:3001/health
```

Должно вернуть:

```json
{
  "status": "ok",
  "timestamp": "2024-01-23T12:00:00.000Z"
}
```

## Step 6: Тестирование OAuth Flow (5 минут)

### 6.1 Откройте Telegram

1. Найдите вашего бота в Telegram
2. Отправьте команду: `/start`

### 6.2 Подключите Google Calendar

1. Отправьте команду: `/connect_google`
2. Вы получите сообщение с кнопкой **"🔐 Авторизоваться через Google"**
3. Нажмите на кнопку
4. Откроется браузер с Google OAuth
5. Войдите в ваш Google аккаунт (если еще не вошли)
6. Нажмите **"Allow"** чтобы дать доступ к календарю
7. Вы будете перенаправлены на success page
8. Вернитесь в Telegram

### 6.3 Проверьте уведомление

В течение 1-2 секунд бот должен отправить сообщение:

```
✅ Google Calendar успешно подключен!

Теперь вы можете:
• 📅 Просматривать события календаря
• ➕ Создавать новые события
• 🔄 Синхронизировать задачи с календарем

💬 Попробуйте:
• "Покажи мои события на сегодня"
• "Создай встречу завтра в 10:00"
```

### 6.4 Проверьте базу данных

Токены должны быть сохранены в БД (в зашифрованном виде):

```bash
# Подключитесь к БД
psql $DATABASE_URL

# Проверьте интеграции
SELECT id, user_id, integration_type, enabled, created_at
FROM user_integrations
WHERE integration_type = 'GoogleCalendar';
```

Вы должны увидеть запись с вашим `user_id`.

### 6.5 Проверьте команду /integrations

В Telegram отправьте:

```
/integrations
```

Должно показать:

```
📊 Интеграции:

✅ GoogleCalendar
```

## Troubleshooting

### Ошибка: "redirect_uri_mismatch"

**Проблема:** Redirect URI не совпадает с настроенным в Google Cloud Console.

**Решение:**
1. Проверьте `GOOGLE_REDIRECT_URI` в `.env`
2. Убедитесь, что точно такой же URI добавлен в Google Cloud Console
3. URI должны совпадать **точно** (включая `http://`, порт, путь)

### Ошибка: "Invalid or expired session"

**Проблема:** OAuth session истекла (TTL 10 минут) или Redis не запущен.

**Решение:**
1. Проверьте что Redis запущен: `redis-cli ping`
2. Попробуйте снова: `/connect_google`

### Ошибка: "API_URL not configured"

**Проблема:** Переменная `API_URL` не установлена в `.env`.

**Решение:**
1. Добавьте в `.env`: `API_URL=http://localhost:3001`
2. Перезапустите бота

### Не приходит уведомление в Telegram

**Проблема:**
- Неверный `TELEGRAM_BOT_TOKEN`
- Бот не может отправить сообщение пользователю

**Решение:**
1. Проверьте `TELEGRAM_BOT_TOKEN` в `.env`
2. Убедитесь что вы отправили `/start` боту
3. Проверьте логи API server на ошибки

### Браузер показывает "This site can't be reached"

**Проблема:** API server не запущен или запущен на другом порту.

**Решение:**
1. Проверьте что API server запущен: `npm run api:dev`
2. Убедитесь что используется порт 3001
3. Проверьте `API_PORT` в `.env`

## Production Deployment

### Настройка для production

1. **Обновите Redirect URI в Google Cloud Console:**
   ```
   https://your-domain.com/oauth/google/callback
   ```

2. **Обновите environment variables:**
   ```bash
   API_URL=https://your-domain.com
   GOOGLE_REDIRECT_URI=https://your-domain.com/oauth/google/callback
   ```

3. **Разверните API server на хостинг** (Railway, Vercel, etc.)

4. **Настройте HTTPS** (обязательно для production!)

5. **Настройте Redis** для production:
   - Railway Redis
   - Upstash
   - Redis Cloud
   - AWS ElastiCache

### Railway Deployment

```bash
# 1. Установите Railway CLI
npm install -g @railway/cli

# 2. Login
railway login

# 3. Инициализируйте проект
railway init

# 4. Добавьте Redis
railway add redis

# 5. Добавьте environment variables в Railway dashboard
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://your-app.railway.app/oauth/google/callback
API_URL=https://your-app.railway.app

# 6. Deploy
railway up
```

## Next Steps

После успешного подключения Google Calendar можно приступить к реализации:

1. **LLM tools для работы с календарем**
   - Просмотр событий
   - Создание событий
   - Обновление событий

2. **Автоматическая синхронизация**
   - Синхронизация задач с календарем
   - Bi-directional sync

3. **Напоминания**
   - Уведомления о предстоящих событиях
   - Интеграция с daily digest

Следующие шаги описаны в [GOOGLE_CALENDAR_INTEGRATION_PLAN.md](GOOGLE_CALENDAR_INTEGRATION_PLAN.md).

## Support

Если возникли проблемы:

1. Проверьте логи API server и бота
2. Убедитесь что все environment variables установлены
3. Проверьте что Redis запущен
4. Проверьте настройки в Google Cloud Console

## Resources

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 Documentation](https://developers.google.com/identity/protocols/oauth2)
- [Redis Documentation](https://redis.io/documentation)

---

**Готово!** 🎉 Google Calendar успешно интегрирован с вашим ботом.
