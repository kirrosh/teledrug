# Google Calendar Integration Plan

## Содержание
1. [Введение](#введение)
2. [Анализ текущей архитектуры](#анализ-текущей-архитектуры)
3. [Архитектура OAuth 2.0 для Telegram](#архитектура-oauth-20-для-telegram)
4. [Детальный план реализации](#детальный-план-реализации)
5. [Структура кода](#структура-кода)
6. [API Reference](#api-reference)
7. [Security Considerations](#security-considerations)
8. [Testing Strategy](#testing-strategy)

---

## Введение

### Цель
Интеграция Google Calendar API с Telegram ботом для синхронизации событий календаря с задачами пользователя.

### Ключевые требования
- ✅ OAuth 2.0 авторизация через внешний браузер
- ✅ Взаимозаменяемость с Яндекс Календарем
- ✅ Простота использования для пользователя
- ✅ Безопасное хранение токенов
- ✅ Автоматическое обновление access tokens

---

## Анализ текущей архитектуры

### Текущая интеграция с Яндекс Календарем

**Технология:** CalDAV через библиотеку `tsdav`

**Модель данных:**
```typescript
// packages/db/src/schema.ts
userIntegrations = {
  integrationType: "YandexCalendar",
  credentialsEncrypted: string,  // Зашифрованные credentials
  credentialsIv: string,         // IV для AES-256-GCM
  credentialsTag: string,        // Auth tag для AES-256-GCM
  enabled: boolean
}
```

**Credentials для Яндекс:**
```typescript
{
  calendarUrl: string,
  username: string,
  password: string
}
```

**Ключевые компоненты:**
1. `packages/core/src/integrations/yandex-calendar/index.ts` - основная логика
2. `packages/core/src/services/calendar-sync.ts` - синхронизация событий
3. `packages/core/src/services/integration-registry.ts` - реестр интеграций
4. `packages/encryption/src/` - шифрование credentials
5. `packages/db/src/schema.ts` - схема БД

**Workflow:**
1. Пользователь предоставляет URL календаря, username и password
2. Credentials шифруются через AES-256-GCM
3. Сохраняются в `userIntegrations`
4. При создании события через LLM - автоматическая синхронизация в календарь
5. Интеграция работает в фоновом режиме (background sync only, no LLM tools)

---

## Архитектура OAuth 2.0 для Telegram

### Проблема: Telegram WebView не имеет Google сессии

Telegram Mini Apps работают в embedded WebView без доступа к cookies браузера и Google сессии пользователя. Стандартный OAuth flow не работает.

### Решение: Deep Link + External Browser Flow

```
[Telegram Bot]
      ↓
[User clicks "Connect Google Calendar"]
      ↓
[Bot sends deep link with unique session_id]
      ↓
[User opens link → External Browser]
      ↓
[Landing page: /oauth/google/start?session_id=XXX]
      ↓
[Redirect to Google OAuth]
      ↓
[User authorizes in Google (имеет сессию в браузере!)]
      ↓
[Google redirects to /oauth/google/callback?code=YYY&state=XXX]
      ↓
[Backend: exchange code → tokens, save to DB]
      ↓
[Redirect to success page: /oauth/google/success?session_id=XXX]
      ↓
[Success page shows "Authorization complete! Return to Telegram"]
      ↓
[Backend sends notification to Telegram bot]
      ↓
[Bot sends message: "✅ Google Calendar connected!"]
```

### Преимущества этого подхода
1. ✅ Пользователь авторизуется в браузере, где уже есть Google сессия
2. ✅ Не требуется polling (используем webhook/bot notification)
3. ✅ PKCE security из коробки
4. ✅ Простой UX - один клик по ссылке
5. ✅ Работает на всех платформах (iOS, Android, Desktop)

---

## Детальный план реализации

### Phase 1: Backend OAuth Infrastructure (Приоритет 1)

#### 1.1 Создать Express API endpoints

**Файл:** `packages/api/src/routes/oauth-google.ts` (новый пакет)

```typescript
import express from 'express';
import { google } from 'googleapis';
import crypto from 'crypto';

const router = express.Router();

// Step 1: Initiate OAuth flow
router.get('/oauth/google/start', async (req, res) => {
  const { session_id, user_id } = req.query;

  // Generate PKCE
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = crypto.randomBytes(32).toString('hex');

  // Store session in Redis (TTL 10 min)
  await redis.setex(`oauth_session:${session_id}`, 600, JSON.stringify({
    user_id,
    code_verifier: codeVerifier,
    state,
    timestamp: Date.now()
  }));

  // Generate Google OAuth URL
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.API_URL}/oauth/google/callback`
  );

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

// Step 2: Handle Google callback
router.get('/oauth/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/oauth/google/error?error=${error}`);
  }

  // Parse state
  const [stateToken, sessionId] = state.split('|');

  // Validate session
  const sessionData = await redis.get(`oauth_session:${sessionId}`);
  if (!sessionData) {
    return res.status(400).send('Invalid or expired session');
  }

  const { user_id, code_verifier, state: storedState } = JSON.parse(sessionData);

  if (stateToken !== storedState) {
    return res.status(400).send('Invalid state parameter');
  }

  // Exchange code for tokens
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    `${process.env.API_URL}/oauth/google/callback`
  );

  const { tokens } = await oauth2Client.getToken({
    code,
    codeVerifier: code_verifier
  });

  // Save tokens to database
  await saveGoogleTokens(user_id, tokens);

  // Clean up session
  await redis.del(`oauth_session:${sessionId}`);

  // Notify Telegram bot
  await notifyTelegramBot(user_id, 'google_calendar_connected');

  // Redirect to success page
  res.redirect(`/oauth/google/success?session_id=${sessionId}`);
});

// Step 3: Success page
router.get('/oauth/google/success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authorization Complete</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
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
        }
        .success-icon {
          font-size: 64px;
          margin-bottom: 20px;
        }
        h1 { color: #333; margin: 0 0 10px 0; }
        p { color: #666; margin: 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✅</div>
        <h1>Authorization Complete!</h1>
        <p>Google Calendar has been successfully connected.</p>
        <p style="margin-top: 20px;">You can now return to Telegram.</p>
      </div>
      <script>
        // Auto-close after 3 seconds
        setTimeout(() => {
          window.close();
        }, 3000);
      </script>
    </body>
    </html>
  `);
});

export default router;
```

#### 1.2 Создать функции для работы с токенами

**Файл:** `packages/core/src/integrations/google-calendar/tokens.ts` (новый)

```typescript
import { Effect } from 'effect';
import { UserRepository } from '../../services/user-repository';
import { google } from 'googleapis';

interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expiry_date: number;
  scope: string;
  token_type: string;
}

export const saveGoogleTokens = async (
  userId: number,
  tokens: GoogleTokens
) => {
  const credentials = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date,
    scope: tokens.scope,
    tokenType: tokens.token_type
  };

  // Save to database (encrypted)
  return Effect.runPromise(
    userRepository.addIntegration(
      userId,
      'GoogleCalendar',
      credentials
    )
  );
};

export const getValidGoogleToken = async (userId: number): Promise<string> => {
  const integration = await Effect.runPromise(
    userRepository.getDecryptedIntegration(userId, 'GoogleCalendar')
  );

  if (Option.isNone(integration)) {
    throw new Error('Google Calendar not connected');
  }

  const { credentials } = integration.value;
  const now = Date.now();

  // Check if token needs refresh (5 min buffer)
  if (credentials.expiryDate - now < 5 * 60 * 1000) {
    return await refreshGoogleToken(userId, credentials.refreshToken);
  }

  return credentials.accessToken;
};

const refreshGoogleToken = async (
  userId: number,
  refreshToken: string
): Promise<string> => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  const { credentials } = await oauth2Client.refreshAccessToken();

  // Update tokens in database
  await saveGoogleTokens(userId, credentials as GoogleTokens);

  return credentials.access_token!;
};
```

### Phase 2: Google Calendar API Client (Приоритет 1)

#### 2.1 Создать интеграцию Google Calendar

**Файл:** `packages/core/src/integrations/google-calendar/index.ts` (новый)

```typescript
import { Effect, Console, Schema } from "effect";
import { tool } from "ai";
import { z } from "zod";
import { google, calendar_v3 } from "googleapis";
import { ToolResultFormatter } from "../../types/integrations";
import { getValidGoogleToken } from "./tokens";

// Schemas (аналогичны Yandex Calendar)
export const GoogleCredentials = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.optional(Schema.String),
  expiryDate: Schema.Number,
  scope: Schema.String,
  tokenType: Schema.String
});

export type GoogleCredentials = Schema.Schema.Type<typeof GoogleCredentials>;

// Calendar Event Schema (тот же, что у Yandex)
const CalendarEventSchema = Schema.Struct({
  id: Schema.optional(Schema.String),
  summary: Schema.String,
  description: Schema.optional(Schema.String),
  startDate: Schema.String,
  endDate: Schema.String,
  location: Schema.optional(Schema.String),
  url: Schema.optional(Schema.String),
  organizer: Schema.optional(Schema.String),
  attendees: Schema.optional(Schema.Array(Schema.String)),
  status: Schema.optional(Schema.String),
  categories: Schema.optional(Schema.Array(Schema.String))
});

type CalendarEvent = Schema.Schema.Type<typeof CalendarEventSchema>;

// Google Calendar API Client
class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  async listEvents(params: {
    timeMin?: Date;
    timeMax?: Date;
    maxResults?: number;
  }): Promise<CalendarEvent[]> {
    const response = await this.calendar.events.list({
      calendarId: 'primary',
      timeMin: params.timeMin?.toISOString(),
      timeMax: params.timeMax?.toISOString(),
      maxResults: params.maxResults || 250,
      singleEvents: true,
      orderBy: 'startTime'
    });

    return (response.data.items || []).map(event => ({
      id: event.id,
      summary: event.summary || '',
      description: event.description,
      startDate: event.start?.dateTime || event.start?.date || '',
      endDate: event.end?.dateTime || event.end?.date || '',
      location: event.location,
      url: event.htmlLink,
      organizer: event.organizer?.displayName || event.organizer?.email,
      attendees: event.attendees?.map(a => a.email || '').filter(Boolean),
      status: event.status,
      categories: undefined // Google uses different categorization
    }));
  }

  async createEvent(params: {
    summary: string;
    startDate: string;
    endDate: string;
    location?: string;
    description?: string;
  }): Promise<{ success: boolean; eventId?: string; event?: CalendarEvent }> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const event: calendar_v3.Schema$Event = {
      summary: params.summary,
      description: params.description || '🤖 Создано через TeleDrug',
      location: params.location,
      start: {
        dateTime: params.startDate,
        timeZone
      },
      end: {
        dateTime: params.endDate,
        timeZone
      }
    };

    const response = await this.calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'none'
    });

    return {
      success: true,
      eventId: response.data.id,
      event: {
        id: response.data.id,
        summary: response.data.summary || '',
        description: response.data.description,
        startDate: response.data.start?.dateTime || response.data.start?.date || '',
        endDate: response.data.end?.dateTime || response.data.end?.date || '',
        location: response.data.location,
        url: response.data.htmlLink
      }
    };
  }
}

// Tools creation (аналогично Yandex Calendar)
export const createGoogleCalendarTools = ({
  userId,
  userTimezone,
  userLocale
}: {
  userId: number;
  userTimezone?: string;
  userLocale?: string;
}) => {
  // Используем те же форматтеры, что и для Yandex Calendar
  // Можно переиспользовать код из yandex-calendar/index.ts

  const tools = {
    getEvents: tool({
      description: "Получение событий из Google Calendar",
      inputSchema: z.object({
        dateRange: z.object({
          start: z.string().optional(),
          end: z.string().optional()
        }).optional(),
        limit: z.number().optional()
      }),
      execute: async ({ dateRange, limit }) => {
        const accessToken = await getValidGoogleToken(userId);
        const client = new GoogleCalendarClient(accessToken);

        const events = await client.listEvents({
          timeMin: dateRange?.start ? new Date(dateRange.start) : undefined,
          timeMax: dateRange?.end ? new Date(dateRange.end) : undefined,
          maxResults: limit
        });

        return {
          success: true,
          events,
          totalCount: events.length
        };
      }
    }),

    createEvent: tool({
      description: "Создание события в Google Calendar",
      inputSchema: z.object({
        summary: z.string(),
        startDate: z.string(),
        endDate: z.string().optional(),
        durationMinutes: z.number().optional(),
        location: z.string().optional(),
        description: z.string().optional()
      }),
      execute: async (input) => {
        const accessToken = await getValidGoogleToken(userId);
        const client = new GoogleCalendarClient(accessToken);

        let endDate = input.endDate;
        if (!endDate && input.durationMinutes) {
          const start = new Date(input.startDate);
          const end = new Date(start.getTime() + input.durationMinutes * 60000);
          endDate = end.toISOString();
        }

        return await client.createEvent({
          summary: input.summary,
          startDate: input.startDate,
          endDate: endDate || input.startDate,
          location: input.location,
          description: input.description
        });
      }
    })
  };

  return { tools, formatters: {}, progressMessages: {} };
};

export const GoogleCalendarIntegration = {
  name: "GoogleCalendar",
  createTools: createGoogleCalendarTools
};
```

### Phase 3: Telegram Bot Integration (Приоритет 2)

#### 3.1 Добавить команду /connect_google

**Файл:** `packages/core/src/bot/telegram/handlers/commands.ts`

```typescript
// Добавить новую команду
bot.command('connect_google', async (ctx) => {
  const userId = ctx.from.id;
  const sessionId = crypto.randomBytes(16).toString('hex');

  // Store session mapping
  await redis.setex(`oauth_user:${sessionId}`, 600, userId.toString());

  const authUrl = `${process.env.API_URL}/oauth/google/start?session_id=${sessionId}&user_id=${userId}`;

  await ctx.reply(
    '🗓️ *Подключение Google Calendar*\n\n' +
    'Для авторизации нажмите на кнопку ниже.\n' +
    'Вы будете перенаправлены в браузер для безопасной авторизации через Google.\n\n' +
    '⚠️ Убедитесь, что вы вошли в свой Google аккаунт в браузере.',
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔐 Авторизоваться через Google', url: authUrl }],
          [{ text: '❌ Отмена', callback_data: 'cancel_oauth' }]
        ]
      }
    }
  );
});

// Обработка callback после успешной авторизации
export const notifyTelegramBot = async (userId: number, event: string) => {
  if (event === 'google_calendar_connected') {
    await bot.telegram.sendMessage(
      userId,
      '✅ *Google Calendar успешно подключен!*\n\n' +
      'Теперь вы можете:\n' +
      '• Просматривать события календаря\n' +
      '• Создавать новые события\n' +
      '• Синхронизировать задачи с календарем\n\n' +
      'Попробуйте: "Покажи мои события на сегодня"',
      { parse_mode: 'Markdown' }
    );
  }
};
```

### Phase 4: Integration Registry Updates (Приоритет 2)

#### 4.1 Обновить Integration Registry

**Файл:** `packages/core/src/services/integration-registry.ts`

```typescript
// В функции getToolsForUser добавить поддержку GoogleCalendar

case "GoogleCalendar": {
  const googleCredentials = credentials as GoogleCredentials;

  const googleBundle = GoogleCalendarIntegration.createTools({
    userId: numericUserId,
    userTimezone: userSettings.timezone,
    userLocale: userSettings.locale
  });

  combined = mergeBundles(combined, googleBundle);

  yield* Effect.sync(() =>
    console.log(
      `📅 Registry: GoogleCalendar integration enabled for user ${numericUserId}`
    )
  );
  break;
}
```

#### 4.2 Обновить Calendar Sync Service

**Файл:** `packages/core/src/services/calendar-sync.ts`

```typescript
// Добавить поддержку синхронизации с Google Calendar

const googleIntegration = integrations.find(
  (entry) =>
    entry.integration.integrationType === "GoogleCalendar" &&
    entry.integration.enabled
);

if (googleIntegration) {
  // Sync to Google Calendar
  const accessToken = await getValidGoogleToken(task.userId);
  const client = new GoogleCalendarClient(accessToken);

  const result = await client.createEvent({
    summary: task.title,
    startDate: task.startAt!.toString(),
    endDate: task.endAt!.toString(),
    location: task.location ?? undefined,
    description: task.description ?? undefined
  });

  if (result.success && result.eventId) {
    // Update task with Google event ID
    // ...
  }
}
```

### Phase 5: Environment & Configuration (Приоритет 1)

#### 5.1 Добавить переменные окружения

**Файл:** `.env`

```bash
# Google OAuth 2.0
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://your-api.com/oauth/google/callback

# API URL for OAuth callbacks
API_URL=https://your-api.com

# Redis for session management
REDIS_URL=redis://localhost:6379
```

#### 5.2 Настроить Google Cloud Console

1. Перейти в [Google Cloud Console](https://console.cloud.google.com/)
2. Создать новый проект или выбрать существующий
3. Включить Google Calendar API
4. Создать OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `https://your-api.com/oauth/google/callback`
5. Скопировать Client ID и Client Secret в `.env`

### Phase 6: Database Migration (Приоритет 1)

Схема БД уже поддерживает любые интеграции через `userIntegrations.integrationType`, миграция не требуется.

Для хранения Google tokens используется та же схема:
- `credentialsEncrypted` - зашифрованный JSON с tokens
- `credentialsIv` - IV для дешифровки
- `credentialsTag` - Auth tag для AES-256-GCM

---

## Структура кода

```
packages/
├── api/                          # Новый пакет для API endpoints
│   ├── src/
│   │   ├── routes/
│   │   │   └── oauth-google.ts   # OAuth endpoints
│   │   ├── middleware/
│   │   │   └── auth.ts           # Authentication middleware
│   │   └── index.ts              # Express app
│   └── package.json
│
├── core/
│   ├── src/
│   │   ├── integrations/
│   │   │   ├── yandex-calendar/
│   │   │   │   └── index.ts
│   │   │   └── google-calendar/  # Новая интеграция
│   │   │       ├── index.ts      # Main integration
│   │   │       ├── tokens.ts     # Token management
│   │   │       └── client.ts     # API client
│   │   ├── services/
│   │   │   ├── calendar-sync.ts  # Обновить для Google
│   │   │   └── integration-registry.ts  # Добавить Google
│   │   └── bot/
│   │       └── telegram/
│   │           └── handlers/
│   │               └── commands.ts  # Добавить /connect_google
│
├── db/
│   └── src/
│       └���─ schema.ts             # Без изменений (универсальная схема)
│
└── encryption/
    └── src/
        └── index.ts              # Без изменений
```

---

## API Reference

### Google Calendar API v3

**Документация:** https://developers.google.com/calendar/api/v3/reference

#### Основные методы

**1. events.list** - Получение событий
```typescript
calendar.events.list({
  calendarId: 'primary',
  timeMin: '2024-01-01T00:00:00Z',
  timeMax: '2024-12-31T23:59:59Z',
  maxResults: 250,
  singleEvents: true,
  orderBy: 'startTime'
})
```

**2. events.insert** - Создание события
```typescript
calendar.events.insert({
  calendarId: 'primary',
  requestBody: {
    summary: 'Meeting',
    start: { dateTime: '2024-03-15T10:00:00Z', timeZone: 'Europe/Moscow' },
    end: { dateTime: '2024-03-15T11:00:00Z', timeZone: 'Europe/Moscow' }
  }
})
```

**3. events.patch** - Обновление события
```typescript
calendar.events.patch({
  calendarId: 'primary',
  eventId: 'event_id',
  requestBody: { summary: 'Updated Meeting' }
})
```

**4. events.delete** - Удаление события
```typescript
calendar.events.delete({
  calendarId: 'primary',
  eventId: 'event_id'
})
```

### OAuth 2.0 Scopes

**Рекомендуемые scopes:**

```typescript
// Минимальный - только события (рекомендуется)
const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// Расширенный - полный доступ к календарю
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Read-only - только чтение
const SCOPES = ['https://www.googleapis.com/auth/calendar.events.readonly'];
```

---

## Security Considerations

### 1. PKCE (Proof Key for Code Exchange)

**Обязательно** использовать PKCE для защиты OAuth flow:

```typescript
// Generate code verifier (43-128 characters)
const codeVerifier = crypto.randomBytes(32).toString('base64url');

// Generate code challenge (SHA-256 hash)
const codeChallenge = crypto
  .createHash('sha256')
  .update(codeVerifier)
  .digest('base64url');

// Store verifier in Redis
await redis.setex(`pkce:${sessionId}`, 600, codeVerifier);

// Use in OAuth URL
oauth2Client.generateAuthUrl({
  code_challenge: codeChallenge,
  code_challenge_method: 'S256'
});

// Exchange with verifier
oauth2Client.getToken({
  code,
  codeVerifier
});
```

### 2. State Parameter Validation

```typescript
// Generate cryptographically secure state
const state = crypto.randomBytes(32).toString('hex');

// Store in Redis with user mapping
await redis.setex(`oauth_state:${state}`, 600, JSON.stringify({
  user_id: userId,
  timestamp: Date.now()
}));

// Validate on callback
const storedData = await redis.get(`oauth_state:${state}`);
if (!storedData || JSON.parse(storedData).user_id !== userId) {
  throw new Error('Invalid state');
}

// One-time use
await redis.del(`oauth_state:${state}`);
```

### 3. Token Encryption

Все токены хранятся в зашифрованном виде через `@teledrug/encryption`:

```typescript
// AES-256-GCM encryption
const encrypted = await encryptionService.encryptJson({
  accessToken: tokens.access_token,
  refreshToken: tokens.refresh_token,
  expiryDate: tokens.expiry_date
});

// Save to database
await db.insert(userIntegrations).values({
  credentialsEncrypted: encrypted.encrypted,
  credentialsIv: encrypted.iv,
  credentialsTag: encrypted.tag
});
```

### 4. Token Refresh Strategy

**Автоматическое обновление за 5 минут до истечения:**

```typescript
const getValidAccessToken = async (userId: number): Promise<string> => {
  const credentials = await getDecryptedCredentials(userId);
  const bufferTime = 5 * 60 * 1000; // 5 minutes

  if (Date.now() >= credentials.expiryDate - bufferTime) {
    return await refreshAccessToken(userId, credentials.refreshToken);
  }

  return credentials.accessToken;
};
```

### 5. HTTPS Only

**В production обязательно:**
- ✅ HTTPS для всех endpoints
- ✅ Secure cookies
- ✅ HSTS headers
- ✅ CSP headers

---

## Testing Strategy

### Unit Tests

```typescript
// packages/core/src/integrations/google-calendar/__tests__/client.test.ts
describe('GoogleCalendarClient', () => {
  it('should list events with date range', async () => {
    const client = new GoogleCalendarClient(mockAccessToken);
    const events = await client.listEvents({
      timeMin: new Date('2024-01-01'),
      timeMax: new Date('2024-12-31')
    });

    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
  });

  it('should create event with all fields', async () => {
    const client = new GoogleCalendarClient(mockAccessToken);
    const result = await client.createEvent({
      summary: 'Test Event',
      startDate: '2024-03-15T10:00:00Z',
      endDate: '2024-03-15T11:00:00Z',
      location: 'Office',
      description: 'Test description'
    });

    expect(result.success).toBe(true);
    expect(result.eventId).toBeDefined();
  });
});
```

### Integration Tests

```typescript
// packages/api/tests/oauth-flow.test.ts
describe('OAuth Flow', () => {
  it('should complete full OAuth flow', async () => {
    // Step 1: Start OAuth
    const startResponse = await request(app)
      .get('/oauth/google/start')
      .query({ session_id: 'test123', user_id: 12345 });

    expect(startResponse.status).toBe(302);
    expect(startResponse.headers.location).toContain('accounts.google.com');

    // Step 2: Simulate callback
    const callbackResponse = await request(app)
      .get('/oauth/google/callback')
      .query({ code: 'test_code', state: 'test_state|test123' });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.location).toContain('/oauth/google/success');

    // Step 3: Verify tokens saved
    const integration = await db.select()
      .from(userIntegrations)
      .where(eq(userIntegrations.userId, 12345));

    expect(integration).toBeDefined();
    expect(integration.integrationType).toBe('GoogleCalendar');
  });
});
```

### E2E Tests

```typescript
// tests/e2e/google-calendar.test.ts
describe('Google Calendar E2E', () => {
  it('should connect calendar and create event', async () => {
    // 1. Send /connect_google command
    await sendMessage('/connect_google');

    // 2. Verify bot response with auth link
    const response = await getLastMessage();
    expect(response.text).toContain('Подключение Google Calendar');
    expect(response.reply_markup.inline_keyboard[0][0].url).toBeDefined();

    // 3. Complete OAuth flow (mocked)
    await completeOAuthFlow(userId);

    // 4. Verify success message
    const successMsg = await getLastMessage();
    expect(successMsg.text).toContain('Google Calendar успешно подключен');

    // 5. Create event via LLM
    await sendMessage('Создай встречу завтра в 10:00');

    // 6. Verify event created in Google Calendar
    const events = await getGoogleCalendarEvents(userId);
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].summary).toContain('встречу');
  });
});
```

---

## Implementation Checklist

### Phase 1: Infrastructure ✅
- [ ] Создать пакет `packages/api`
- [ ] Настроить Express server
- [ ] Реализовать OAuth endpoints
- [ ] Настроить Redis для sessions
- [ ] Добавить environment variables
- [ ] Настроить Google Cloud Console

### Phase 2: Google Calendar Client ✅
- [ ] Создать `packages/core/src/integrations/google-calendar/`
- [ ] Реализовать `GoogleCalendarClient`
- [ ] Реализовать token management
- [ ] Реализовать auto-refresh logic
- [ ] Добавить error handling

### Phase 3: Integration with Bot ✅
- [ ] Добавить команду `/connect_google`
- [ ] Реализовать notification callback
- [ ] Обновить Integration Registry
- [ ] Обновить Calendar Sync Service
- [ ] Добавить UI для success page

### Phase 4: Testing ✅
- [ ] Unit tests для GoogleCalendarClient
- [ ] Integration tests для OAuth flow
- [ ] E2E tests для полного цикла
- [ ] Security audit

### Phase 5: Documentation ✅
- [ ] API documentation
- [ ] User guide
- [ ] Developer guide
- [ ] Troubleshooting guide

---

## Frequently Asked Questions

### Q: Почему нельзя использовать CalDAV для Google Calendar?

**A:** Google deprecated CalDAV password authentication. OAuth 2.0 - единственный supported метод для нового API доступа.

### Q: Можно ли использовать Service Account вместо OAuth?

**A:** Нет, Service Accounts не имеют доступа к личным календарям пользователей. Требуется OAuth 2.0 с user consent.

### Q: Как обрабатывать revoked tokens?

**A:** При получении 401 Unauthorized:
1. Попытаться refresh token
2. Если refresh fails → пометить интеграцию как `enabled: false`
3. Отправить уведомление пользователю о необходимости повторной авторизации

### Q: Нужно ли хранить sync tokens?

**A:** Да, для оптимизации. Google Calendar API поддерживает incremental sync через `syncToken`:

```typescript
// First sync - get all events + sync token
const response = await calendar.events.list({
  calendarId: 'primary',
  timeMin: new Date(Date.now() - 30*24*60*60*1000).toISOString()
});

const syncToken = response.data.nextSyncToken;
await saveSyncToken(userId, syncToken);

// Subsequent syncs - only changes
const updates = await calendar.events.list({
  calendarId: 'primary',
  syncToken: savedSyncToken
});
```

---

## Next Steps

1. **Реализовать базовый OAuth flow** (это документ - план)
2. **Протестировать на staging окружении**
3. **Добавить Google Calendar в production**
4. **Собрать feedback от пользователей**
5. **Iterate на UX improvements**

---

## References

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/v3/reference)
- [OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [PKCE Specification (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- [googleapis Node.js Client](https://github.com/googleapis/google-api-nodejs-client)
- [Telegram WebApp Documentation](https://core.telegram.org/bots/webapps)

---

**Last Updated:** 2025-01-23
**Version:** 1.0
**Author:** AI Assistant
**Status:** Draft
