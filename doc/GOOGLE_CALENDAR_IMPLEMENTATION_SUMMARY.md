# Google Calendar Integration: Резюме реализации

## Ключевые выводы

### ✅ Выбранный подход: OAuth 2.0 + Deep Link Flow

**Почему именно этот подход:**
1. Google Calendar API больше не поддерживает CalDAV с password authentication
2. OAuth 2.0 - единственный официально поддерживаемый метод
3. Telegram WebView не имеет Google сессии → требуется внешний браузер
4. Deep Link позволяет вернуть пользователя обратно в Telegram

### 🏗️ Архитектура решения

```
User Flow:
1. Пользователь нажимает /connect_google в боте
2. Бот отправляет deep link с уникальным session_id
3. Ссылка открывается во внешнем браузере (где есть Google сессия!)
4. Пользователь авторизуется в Google
5. Google возвращает на наш callback endpoint
6. Backend обменивает code на tokens и сохраняет в БД
7. Бот отправляет уведомление об успешном подключении
```

**Технологии:**
- `googleapis` npm package - официальный клиент Google API
- OAuth 2.0 Authorization Code Flow с PKCE
- Redis для хранения временных сессий
- AES-256-GCM для шифрования tokens в БД
- Express API для OAuth endpoints

### 📦 Структура изменений

**Новые компоненты:**
```
packages/api/                           # Новый пакет для API
  └── src/routes/oauth-google.ts       # OAuth flow endpoints

packages/core/src/integrations/
  └── google-calendar/                 # Новая интеграция
      ├── index.ts                     # Tools и API client
      ├── tokens.ts                    # Token management
      └── client.ts                    # Google Calendar API wrapper
```

**Изменения в существующих файлах:**
- `packages/core/src/services/integration-registry.ts` - добавить GoogleCalendar case
- `packages/core/src/services/calendar-sync.ts` - поддержка синхронизации с Google
- `packages/core/src/bot/telegram/handlers/commands.ts` - команда /connect_google
- `.env` - добавить GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

**БД изменения:** ❌ Не требуются!
- Существующая схема `userIntegrations` универсальна
- Поддерживает любой `integrationType`
- Credentials шифруются через existing encryption service

### 🔐 Security Features

1. **PKCE (Proof Key for Code Exchange)**
   - Защита от authorization code interception
   - Обязательный стандарт OAuth 2.1

2. **State Parameter Validation**
   - Криптографически стойкий state token
   - One-time use через Redis TTL
   - Защита от CSRF атак

3. **Token Encryption**
   - AES-256-GCM шифрование
   - Уникальный IV для каждого токена
   - Authentication tag для integrity

4. **Auto-refresh Tokens**
   - Обновление за 5 минут до истечения
   - Бесшовный UX без re-authentication
   - Graceful handling при revoked tokens

### 🎯 Минимальная реализация (MVP)

**Phase 1: Только авторизация** (текущий запрос)
```typescript
// Что нужно реализовать:
1. ✅ OAuth endpoints (/start, /callback, /success)
2. ✅ Token storage в БД (encrypted)
3. ✅ Telegram command /connect_google
4. ✅ Success notification в боте

// Что НЕ нужно:
- ❌ LLM tools (пока)
- ❌ Calendar sync (пока)
- ❌ Event creation (пока)
```

**Минимальный код для авторизации:**

```typescript
// 1. API endpoint (packages/api/src/routes/oauth-google.ts)
router.get('/oauth/google/start', async (req, res) => {
  const { session_id, user_id } = req.query;

  // Generate PKCE
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256')
    .update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(32).toString('hex');

  // Store in Redis
  await redis.setex(`oauth:${session_id}`, 600, JSON.stringify({
    user_id, code_verifier, state
  }));

  // Redirect to Google
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: `${state}|${session_id}`,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
  });

  res.redirect(authUrl);
});

router.get('/oauth/google/callback', async (req, res) => {
  const { code, state } = req.query;
  const [stateToken, sessionId] = state.split('|');

  // Validate session
  const session = JSON.parse(await redis.get(`oauth:${sessionId}`));
  if (stateToken !== session.state) {
    return res.status(400).send('Invalid state');
  }

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken({
    code,
    codeVerifier: session.code_verifier
  });

  // Save to database (encrypted)
  await Effect.runPromise(
    userRepository.addIntegration(
      session.user_id,
      'GoogleCalendar',
      {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiryDate: tokens.expiry_date
      }
    )
  );

  // Notify bot
  await bot.telegram.sendMessage(
    session.user_id,
    '✅ Google Calendar успешно подключен!'
  );

  // Cleanup
  await redis.del(`oauth:${sessionId}`);

  res.redirect('/oauth/google/success');
});

// 2. Telegram command
bot.command('connect_google', async (ctx) => {
  const sessionId = crypto.randomBytes(16).toString('hex');
  const authUrl = `${API_URL}/oauth/google/start?session_id=${sessionId}&user_id=${ctx.from.id}`;

  await ctx.reply(
    '🗓️ Для подключения Google Calendar нажмите кнопку ниже:',
    {
      reply_markup: {
        inline_keyboard: [[
          { text: '🔐 Авторизоваться', url: authUrl }
        ]]
      }
    }
  );
});
```

### 📊 Сравнение подходов

| Критерий | Yandex Calendar (CalDAV) | Google Calendar (OAuth 2.0) |
|----------|--------------------------|------------------------------|
| **Авторизация** | Username + Password | OAuth 2.0 + Deep Link |
| **Безопасность** | Basic Auth | Access + Refresh Tokens |
| **Протокол** | CalDAV (WebDAV) | REST API (JSON) |
| **Токены** | Не требуются | Auto-refresh каждый час |
| **Browser required** | ❌ Нет | ✅ Да (для OAuth) |
| **UX сложность** | Простой | Средний (1 клик) |
| **Долгосрочность** | Credentials не истекают | Refresh token бессрочный |

### ⚡ Преимущества выбранного решения

1. **Единственный работающий метод**
   - Google deprecated CalDAV password auth
   - OAuth 2.0 - mandatory для новых приложений

2. **Максимальная безопасность**
   - Пользователь не вводит пароль в бота
   - Токены encrypted в БД
   - PKCE защита

3. **Лучший UX**
   - Один клик по кнопке
   - Авторизация в браузере (где уже есть Google сессия!)
   - Автоматическое уведомление после подключения

4. **Долгосрочная стабильность**
   - Официальный метод от Google
   - Refresh tokens не истекают
   - Auto-refresh каждый час

### 🚀 Next Steps для MVP

**Step 1: Setup Google Cloud Console** (5 min)
```bash
1. Перейти на https://console.cloud.google.com/
2. Создать новый проект
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials
5. Add redirect URI: https://your-api.com/oauth/google/callback
6. Скопировать Client ID и Secret
```

**Step 2: Setup Backend** (30 min)
```bash
# Создать API пакет
cd packages
mkdir api
cd api
npm init -y
npm install express googleapis ioredis

# Добавить OAuth endpoints
# (см. код выше)
```

**Step 3: Update Bot** (15 min)
```bash
# Добавить команду /connect_google
# Добавить callback для уведомления
```

**Step 4: Environment Variables** (5 min)
```bash
# .env
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_REDIRECT_URI=https://api.example.com/oauth/google/callback
API_URL=https://api.example.com
REDIS_URL=redis://localhost:6379
```

**Step 5: Test** (15 min)
```bash
1. Запустить API server
2. Отправить /connect_google в бота
3. Кликнуть на кнопку авторизации
4. Авторизоваться в Google
5. Проверить уведомление в боте
6. Проверить запись в БД
```

**Total time: ~70 минут**

### 📝 Альтернативные подходы (не рекомендуются)

#### ❌ Вариант 1: Polling вместо notification
```typescript
// Mini app периодически проверяет статус
setInterval(async () => {
  const status = await fetch('/api/auth/status/${sessionId}');
  if (status.completed) {
    alert('Connected!');
  }
}, 2000);
```

**Минусы:**
- Повышенная нагрузка на сервер
- Задержка до 2 секунд
- Пользователь должен оставаться в Mini App

#### ❌ Вариант 2: Service Account
```typescript
// Использовать Service Account вместо OAuth
const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account-key.json',
  scopes: ['https://www.googleapis.com/auth/calendar']
});
```

**Минусы:**
- ❌ Service Accounts НЕ имеют доступа к личным календарям
- Работает только для G Suite domain-wide delegation
- Не подходит для личных аккаунтов

### 🎨 UI/UX детали

**Success Page Design:**
```html
<!DOCTYPE html>
<html>
<head>
  <title>Authorization Complete</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, system-ui, 'Segoe UI', Roboto;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 20px;
      text-align: center;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 400px;
    }
    .success-icon {
      font-size: 64px;
      animation: bounce 0.5s;
    }
    @keyframes bounce {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-20px); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>Успешно!</h1>
    <p>Google Calendar подключен.</p>
    <p>Вернитесь в Telegram, чтобы продолжить.</p>
  </div>
  <script>
    // Auto-close после 3 секунд
    setTimeout(() => window.close(), 3000);
  </script>
</body>
</html>
```

**Bot Message Template:**
```typescript
await ctx.reply(
  '✅ *Google Calendar успешно подключен!*\n\n' +
  'Теперь доступно:\n' +
  '• 📅 Просмотр событий календаря\n' +
  '• ➕ Создание новых событий\n' +
  '• 🔄 Автоматическая синхронизация\n\n' +
  '💬 Попробуйте:\n' +
  '• "Покажи мои события на сегодня"\n' +
  '• "Создай встречу завтра в 10:00"\n' +
  '• "Какие у меня планы на неделю?"',
  { parse_mode: 'Markdown' }
);
```

### 📚 Дополнительные ресурсы

**Документация:**
- [Google Calendar API Reference](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 Web Server Flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [PKCE Spec (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- [googleapis Node.js Client](https://github.com/googleapis/google-api-nodejs-client)

**Примеры кода:**
- [Official Google Calendar Quickstart](https://developers.google.com/calendar/api/quickstart/nodejs)
- [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/)

**Tools:**
- [Google Cloud Console](https://console.cloud.google.com/)
- [OAuth Debugger](https://oauthdebugger.com/)
- [JWT.io](https://jwt.io/) - для отладки токенов

---

## Заключение

### ✅ Готово к реализации

Предложенный подход:
- ✅ Безопасный (PKCE + State validation)
- ✅ Простой для пользователя (1 клик)
- ✅ Надежный (официальный Google API)
- ✅ Масштабируемый (работает для любого количества пользователей)
- ✅ Совместимый с текущей архитектурой

### 📋 MVP Checklist

- [ ] Настроить Google Cloud Console
- [ ] Создать API endpoints (/start, /callback, /success)
- [ ] Добавить команду /connect_google в бота
- [ ] Реализовать token storage (encrypted)
- [ ] Добавить notification callback
- [ ] Протестировать полный flow
- [ ] Deploy на staging
- [ ] Собрать feedback от тестовых пользователей

### 🎯 Estimated Time: 4-6 часов
- Setup (1 час)
- OAuth endpoints (2 часа)
- Bot integration (1 час)
- Testing & debugging (1-2 часа)

---

**Готов к началу реализации!** 🚀

Следующий шаг: создать пакет `packages/api` и начать с OAuth endpoints.
