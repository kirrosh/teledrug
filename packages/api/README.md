# @teledrug/api

OAuth API server для интеграций TeleDrug.

## Установка

```bash
cd packages/api
npm install
```

## Настройка

### 1. Создайте `.env` файл

Скопируйте `.env.example` и заполните значения:

```bash
cp .env.example .env
```

### 2. Настройте Google Cloud Console

1. Перейдите на https://console.cloud.google.com/
2. Создайте новый проект или выберите существующий
3. Включите **Google Calendar API**:
   - APIs & Services → Library
   - Найдите "Google Calendar API"
   - Нажмите "Enable"

4. Создайте OAuth 2.0 credentials:
   - APIs & Services → Credentials
   - Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Name: `TeleDrug OAuth`
   - Authorized redirect URIs:
     - Development: `http://localhost:3001/oauth/google/callback`
     - Production: `https://your-domain.com/oauth/google/callback`

5. Скопируйте Client ID и Client Secret в `.env`:
   ```bash
   GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
   ```

### 3. Запустите Redis

OAuth сессии хранятся в Redis:

```bash
# Используя Docker
docker run -d -p 6379:6379 redis:alpine

# Или через Homebrew (macOS)
brew install redis
brew services start redis
```

## Запуск

### Development

```bash
npm run dev
```

Server запустится на `http://localhost:3001`

### Production

```bash
npm run build
npm start
```

## API Endpoints

### OAuth Flow

#### 1. Start OAuth Flow
```
GET /oauth/google/start?session_id=XXX&user_id=YYY
```

Инициирует OAuth flow и перенаправляет на Google.

**Parameters:**
- `session_id` - уникальный ID сессии
- `user_id` - Telegram user ID

**Response:** 302 Redirect to Google OAuth

---

#### 2. OAuth Callback
```
GET /oauth/google/callback?code=XXX&state=YYY
```

Обрабатывает callback от Google, обменивает code на tokens и сохраняет в БД.

**Parameters:**
- `code` - authorization code от Google
- `state` - state token для CSRF protection

**Response:** 302 Redirect to success/error page

---

#### 3. Success Page
```
GET /oauth/google/success?session_id=XXX
```

Показывает страницу успешной авторизации.

---

#### 4. Error Page
```
GET /oauth/google/error?error=XXX
```

Показывает страницу с ошибкой авторизации.

---

### Health Check
```
GET /health
```

Проверка статуса сервера.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-23T12:00:00.000Z"
}
```

## Architecture

### OAuth Flow Diagram

```
┌─────────────┐
│ Telegram    │
│ Bot         │
└──────┬──────┘
       │ 1. /connect_google
       │    generates session_id
       ↓
┌─────────────┐
│ User clicks │
│ auth button │
└──────┬──────┘
       │ 2. Opens external browser
       │    GET /oauth/google/start
       ↓
┌─────────────┐
│ API Server  │
│ (Express)   │
└──────┬──────┘
       │ 3. Store session in Redis
       │    Generate PKCE params
       │    Redirect to Google
       ↓
┌─────────────┐
│ Google      │
│ OAuth       │
└──────┬──────┘
       │ 4. User authorizes
       │    Redirect with code
       ↓
┌─────────────┐
│ API Server  │
│ /callback   │
└──────┬──────┘
       │ 5. Validate state
       │    Exchange code for tokens
       │    Encrypt & save to DB
       │    Send Telegram notification
       ↓
┌─────────────┐
│ Success     │
│ Page        │
└─────────────┘
```

### Security Features

1. **PKCE (Proof Key for Code Exchange)**
   - Защита от authorization code interception
   - SHA-256 code challenge

2. **State Parameter**
   - Криптографически стойкий random token
   - Защита от CSRF атак
   - One-time use (TTL 10 min)

3. **Token Encryption**
   - AES-256-GCM шифрование
   - Хранение в PostgreSQL
   - Используется `@teledrug/encryption`

4. **Session Management**
   - Хранение в Redis
   - TTL 10 минут
   - Автоматическая очистка

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `API_PORT` | Port для API server | `3001` |
| `API_URL` | Public URL API сервера | `http://localhost:3001` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-xxx` |
| `GOOGLE_REDIRECT_URI` | OAuth redirect URI | `http://localhost:3001/oauth/google/callback` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | `123456:ABC-DEF` |
| `DATABASE_URL` | PostgreSQL connection URL | `postgresql://...` |
| `ENCRYPTION_MASTER_KEY` | Encryption key (64 hex chars) | `abc123...` |

## Development

### Testing OAuth Flow Locally

1. Запустите все сервисы:
   ```bash
   # Terminal 1: Redis
   redis-server

   # Terminal 2: API Server
   cd packages/api
   npm run dev

   # Terminal 3: Telegram Bot
   cd ../..
   npm run dev
   ```

2. Используйте ngrok для публичного URL:
   ```bash
   ngrok http 3001
   ```

3. Обновите `GOOGLE_REDIRECT_URI` и `API_URL` в Google Cloud Console и `.env`

4. Отправьте `/connect_google` в Telegram боте

### Debugging

Логи выводятся в консоль:

```
🔐 OAuth flow initiated for user 12345, session abc123
🔐 Exchanging code for tokens, user 12345, session abc123
✅ Tokens received for user 12345
💾 Tokens saved to database for user 12345
🧹 Session cleaned up: abc123
📱 Telegram notification sent to user 12345
```

## Troubleshooting

### Error: "redirect_uri_mismatch"

**Причина:** Redirect URI в запросе не совпадает с настроенным в Google Cloud Console.

**Решение:**
1. Проверьте `GOOGLE_REDIRECT_URI` в `.env`
2. Убедитесь, что этот URI добавлен в Google Cloud Console
3. URI должны совпадать **точно** (включая http/https, порт, путь)

### Error: "Invalid or expired session"

**Причина:** OAuth session истекла (TTL 10 минут) или не существует.

**Решение:**
1. Проверьте, что Redis запущен
2. Попробуйте снова `/connect_google`
3. Увеличьте TTL в коде (по умолчанию 600 секунд)

### Error: "Failed to send Telegram notification"

**Причина:** Неверный `TELEGRAM_BOT_TOKEN` или бот не может отправить сообщение пользователю.

**Решение:**
1. Проверьте `TELEGRAM_BOT_TOKEN` в `.env`
2. Убедитесь, что пользователь запустил бота (`/start`)
3. Проверьте логи для деталей

## Production Deployment

### Railway

```bash
# 1. Создайте Redis service
railway add

# 2. Добавьте environment variables в Railway dashboard
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://your-domain.railway.app/oauth/google/callback
API_URL=https://your-domain.railway.app

# 3. Deploy
railway up
```

### Vercel (Serverless)

API endpoints можно развернуть как Vercel Functions:

```bash
vercel deploy
```

Используйте Vercel KV (Redis) для session storage.

## License

MIT
