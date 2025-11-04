# Google Calendar Integration: Quick Start

## TL;DR

```bash
# 1. Настройте Google Cloud Console
# https://console.cloud.google.com/
# - Создайте проект
# - Enable Google Calendar API
# - Create OAuth 2.0 credentials
# - Add redirect URI: http://localhost:3001/oauth/google/callback

# 2. Добавьте в .env
cat >> .env << EOF
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth/google/callback
API_URL=http://localhost:3001
API_PORT=3001
REDIS_URL=redis://localhost:6379
EOF

# 3. Установите зависимости
cd packages/api && npm install && cd ../..

# 4. Запустите Redis
docker run -d --name teledrug-redis -p 6379:6379 redis:alpine

# 5. Запустите API Server (Terminal 1)
npm run api:dev

# 6. Запустите Bot (Terminal 2)
npm run bot:dev

# 7. В Telegram
/connect_google
# Нажмите кнопку → Авторизуйтесь в Google → Готово!
```

## Что создано?

### Новый пакет: `packages/api`

```
packages/api/
├── src/
│   ├── routes/
│   │   └── oauth-google.ts    # OAuth endpoints
│   ├── utils/
│   │   ├── pkce.ts            # PKCE security
│   │   ├── redis.ts           # Session storage
│   │   └── telegram.ts        # Bot notifications
│   ├── middleware/
│   │   └── error-handler.ts
│   └── index.ts               # Express app
├── package.json
├── tsconfig.json
└── README.md
```

### Endpoints

- `GET /oauth/google/start` - Начало OAuth flow
- `GET /oauth/google/callback` - Google callback
- `GET /oauth/google/success` - Success page
- `GET /oauth/google/error` - Error page
- `GET /health` - Health check

### Telegram Bot

Новая команда: `/connect_google`

- Генерирует уникальный session ID
- Отправляет deep link на OAuth endpoint
- Получает notification после авторизации

### База данных

Изменений НЕ требуется! Используется существующая таблица `user_integrations`:

```sql
SELECT * FROM user_integrations
WHERE integration_type = 'GoogleCalendar';
```

Credentials хранятся в зашифрованном виде (AES-256-GCM).

## Architecture

```
┌──────────────┐
│ User         │
│ /connect_    │
│ google       │
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ Telegram Bot │ Generate session_id
│ (Grammy)     │ Create deep link
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ External     │ User has Google
│ Browser      │ session!
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ API Server   │ Store session (Redis)
│ (Express)    │ PKCE params
└──────┬───────┘
       │ Redirect to Google
       ↓
┌──────────────┐
│ Google OAuth │ User authorizes
│              │ Redirect with code
└──────┬───────┘
       │
       ↓
┌──────────────┐
│ API Server   │ Validate state
│ /callback    │ Exchange code → tokens
└──────┬───────┘ Encrypt & save to DB
       │         Send notification
       ↓
┌──────────────┐
│ Telegram Bot │ ✅ Connected!
│ Notification │
└──────────────┘
```

## Security Features

✅ **PKCE** - Proof Key for Code Exchange (RFC 7636)
✅ **State validation** - CSRF protection
✅ **AES-256-GCM** - Token encryption
✅ **Redis TTL** - Session expiration (10 min)
✅ **One-time use** - State tokens can't be reused

## Environment Variables

### Required (новые)

```bash
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_REDIRECT_URI=http://localhost:3001/oauth/google/callback
API_URL=http://localhost:3001
REDIS_URL=redis://localhost:6379
```

### Already exists

```bash
TELEGRAM_BOT_TOKEN=xxx
DATABASE_URL=postgresql://...
ENCRYPTION_MASTER_KEY=xxx
```

## Testing

### Manual Test

1. Start services:
   ```bash
   # Terminal 1: Redis
   docker run -d -p 6379:6379 redis:alpine

   # Terminal 2: API
   npm run api:dev

   # Terminal 3: Bot
   npm run bot:dev
   ```

2. In Telegram:
   ```
   /connect_google
   ```

3. Click button → Authorize in browser → Done!

### Check logs

API Server should log:
```
🔐 OAuth flow initiated for user 12345, session abc123
🔐 Exchanging code for tokens, user 12345, session abc123
✅ Tokens received for user 12345
💾 Tokens saved to database for user 12345
📱 Telegram notification sent to user 12345
```

### Check database

```sql
-- Check integration
SELECT id, user_id, integration_type, enabled, created_at
FROM user_integrations
WHERE integration_type = 'GoogleCalendar';

-- Should return one row with your user_id
```

## Next Steps

После успешной авторизации:

1. ✅ **Авторизация работает** (текущий этап)
2. ⏳ **Implement Google Calendar API client** - чтение/создание событий
3. ⏳ **Add LLM tools** - интеграция с AI agent
4. ⏳ **Calendar sync** - автоматическая синхронизация задач

## Full Documentation

- [Setup Guide](GOOGLE_CALENDAR_SETUP_GUIDE.md) - Пошаговая установка
- [Integration Plan](GOOGLE_CALENDAR_INTEGRATION_PLAN.md) - Полный технический план
- [Implementation Summary](GOOGLE_CALENDAR_IMPLEMENTATION_SUMMARY.md) - Архитектура и детали

## Troubleshooting

### "redirect_uri_mismatch"
➜ Check `GOOGLE_REDIRECT_URI` in `.env` matches Google Cloud Console exactly

### "Invalid or expired session"
➜ Check Redis is running: `redis-cli ping`

### No Telegram notification
➜ Check bot can send messages to user (try `/start` first)

### "API_URL not configured"
➜ Add `API_URL=http://localhost:3001` to `.env`

## Common Commands

```bash
# Install dependencies
npm install

# Start API server (dev)
npm run api:dev

# Start API server (production)
npm run api:build
npm run api:start

# Start bot
npm run bot:dev

# Check health
curl http://localhost:3001/health

# Test Redis
redis-cli ping
```

## Files Changed

### New Files

- ✅ `packages/api/` - Весь новый пакет
- ✅ `doc/GOOGLE_CALENDAR_INTEGRATION_PLAN.md`
- ✅ `doc/GOOGLE_CALENDAR_IMPLEMENTATION_SUMMARY.md`
- ✅ `doc/GOOGLE_CALENDAR_SETUP_GUIDE.md`
- ✅ `doc/GOOGLE_CALENDAR_QUICKSTART.md`

### Modified Files

- ✅ `packages/core/src/bot/telegram/handlers/commands.ts` - Added `/connect_google`
- ✅ `.env.example` - Added Google OAuth vars
- ✅ `package.json` - Added `api:*` scripts

### Database

- ✅ **No changes required!** Existing schema already supports any integration type.

## Production Checklist

Before deploying to production:

- [ ] Update redirect URI in Google Cloud Console
- [ ] Set `GOOGLE_REDIRECT_URI` to production URL
- [ ] Set `API_URL` to production URL
- [ ] Use production Redis (Railway Redis, Upstash, etc.)
- [ ] Enable HTTPS
- [ ] Set `NODE_ENV=production`
- [ ] Review security settings in Google Cloud Console
- [ ] Test OAuth flow end-to-end
- [ ] Monitor logs for errors

---

**Ready to start!** 🚀

For detailed setup instructions, see [GOOGLE_CALENDAR_SETUP_GUIDE.md](GOOGLE_CALENDAR_SETUP_GUIDE.md)
