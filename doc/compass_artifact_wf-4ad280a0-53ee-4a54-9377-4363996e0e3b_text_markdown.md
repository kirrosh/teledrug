# Интеграция Google Calendar API с Telegram ботом: полное техническое руководство

Интеграция Google Calendar API с Telegram mini app требует трёхуровневой архитектуры с OAuth 2.0 аутентификацией, серверным управлением токенами и системой глубоких ссылок для возврата пользователей. **Authorization Code Flow** является единственным подходящим OAuth потоком для этой задачи, обеспечивая refresh токены и долгосрочный доступ к API. Ключевые компоненты включают серверную валидацию Telegram initData, шифрование токенов в базе данных через AES-256-GCM, автоматическое обновление access tokens за 5 минут до истечения и использование iron-session для управления сессиями.

Техническое решение строится на TypeScript с использованием библиотеки `googleapis` для Calendar API v3, `telegraf` для бота и `@telegram-apps/init-data-node` для валидации аутентификации. Архитектура должна включать rate limiting через Redis, экспоненциальный backoff для обработки квот Google API и систему push-уведомлений через webhooks для отслеживания изменений календаря. Production развёртывание требует HTTPS, secrets manager вместо environment variables, и реализацию PKCE для дополнительной безопасности OAuth потока.

## OAuth 2.0 аутентификация без Google сессии в контексте Telegram

Главная техническая проблема заключается в том, что Telegram mini apps работают в embedded WebView, который не поддерживает стандартные browser-based OAuth редиректы. Решение требует архитектуры из трёх уровней: **mini app инициирует аутентификацию и открывает внешний браузер**, **backend сервер обрабатывает OAuth callback и обменивает код на токены**, **Telegram deep link возвращает пользователя обратно в приложение**.

### Пошаговая реализация OAuth flow

Процесс начинается с валидации Telegram пользователя на сервере. Каждый запрос от mini app должен включать `initData` - строку с подписью HMAC-SHA-256, которую необходимо верифицировать:

```typescript
import { validate } from '@telegram-apps/init-data-node';

async function authenticateTelegramUser(initData: string) {
  try {
    validate(initData, process.env.TELEGRAM_BOT_TOKEN!, { 
      expiresIn: 3600  // 1 час
    });
    
    const params = new URLSearchParams(initData);
    const userData = JSON.parse(params.get('user')!);
    return userData;
  } catch (error) {
    throw new Error('INVALID_TELEGRAM_AUTH');
  }
}
```

После валидации генерируется OAuth URL с **криптографически защищённым state параметром**. State параметр критически важен для защиты от CSRF атак - без него приложение уязвимо к инъекциям authorization code. State должен храниться на сервере в Redis с TTL 10 минут и быть одноразовым:

```typescript
import crypto from 'crypto';
import { google } from 'googleapis';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

async function initiateGoogleAuth(telegramUserId: number): Promise<string> {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  // Генерация state: 32 байта случайных данных
  const state = crypto.randomBytes(32).toString('hex');
  
  // Сохранение state с связкой к Telegram пользователю
  await redis.setex(
    `oauth_state:${state}`,
    600,
    JSON.stringify({
      telegram_user_id: telegramUserId,
      timestamp: Date.now()
    })
  );
  
  // OAuth URL с обязательными параметрами
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',     // Получить refresh token
    scope: ['https://www.googleapis.com/auth/calendar.events'],
    state: state,
    prompt: 'consent',          // Всегда показывать экран согласия
    code_challenge_method: 'S256',  // PKCE для дополнительной безопасности
    code_challenge: generateCodeChallenge()
  });
}
```

### Обработка redirect и exchange кода на токены

Критически важно: **нельзя использовать redirect напрямую в Telegram**. Google Cloud Console должен иметь redirect URI на ваш собственный HTTPS сервер, не `tg://` протокол и не `https://t.me/` URL. После получения callback:

```typescript
import express from 'express';

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  
  // Обработка отказа пользователя
  if (error === 'access_denied') {
    return res.redirect(
      `https://t.me/${process.env.BOT_USERNAME}?start=auth_cancelled`
    );
  }
  
  // Валидация state - защита от CSRF
  const storedData = await redis.get(`oauth_state:${state}`);
  if (!storedData) {
    return res.status(400).send('Invalid or expired state');
  }
  
  const { telegram_user_id } = JSON.parse(storedData);
  await redis.del(`oauth_state:${state}`);  // Одноразовое использование
  
  // Exchange authorization code на tokens
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  
  const { tokens } = await oauth2Client.getToken(code as string);
  
  // Сохранение зашифрованных токенов
  await storeEncryptedTokens(telegram_user_id, tokens);
  
  // Redirect обратно в Telegram через deep link
  res.redirect(
    `https://t.me/${process.env.BOT_USERNAME}?start=auth_success_${state}`
  );
});
```

### Альтернатива: polling механизм

Для более плавного UX можно использовать polling вместо deep linking. Mini app периодически проверяет статус аутентификации на сервере:

```typescript
// Frontend (Mini App)
async function connectGoogleCalendar() {
  const response = await fetch('/api/auth/google/initiate', {
    method: 'POST',
    body: JSON.stringify({ initData: window.Telegram.WebApp.initData })
  });
  
  const { authUrl, authSessionId } = await response.json();
  
  // Открыть OAuth в внешнем браузере
  window.Telegram.WebApp.openLink(authUrl);
  
  // Начать polling
  const pollInterval = setInterval(async () => {
    const statusResponse = await fetch(`/api/auth/status/${authSessionId}`);
    const { completed, success } = await statusResponse.json();
    
    if (completed) {
      clearInterval(pollInterval);
      if (success) {
        window.Telegram.WebApp.showAlert('✅ Календарь подключён!');
        loadCalendarData();
      }
    }
  }, 2000);  // Каждые 2 секунды
  
  // Timeout через 5 минут
  setTimeout(() => clearInterval(pollInterval), 300000);
}
```

## Шифрование и хранение токенов в базе данных

Токены OAuth **никогда не должны храниться в открытом виде**. Используйте **AES-256-GCM** или **AES-256-CTR** с уникальным initialization vector (IV) для каждого токена:

```typescript
import crypto from 'crypto';

class TokenEncryption {
  private encryptionKey: Buffer;
  
  constructor() {
    // 32-байтовый ключ из environment (256 бит)
    this.encryptionKey = Buffer.from(
      process.env.TOKEN_ENCRYPTION_KEY!,
      'hex'
    );
  }
  
  encrypt(token: string): string {
    const iv = crypto.randomBytes(16);  // Уникальный IV для каждого токена
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    const encrypted = Buffer.concat([
      cipher.update(token, 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();  // GCM authentication tag
    
    // Возвращаем IV + authTag + encrypted data
    return JSON.stringify({
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted.toString('hex')
    });
  }
  
  decrypt(encryptedData: string): string {
    const { iv, authTag, data } = JSON.parse(encryptedData);
    
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(iv, 'hex')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'hex')),
      decipher.final()
    ]).toString('utf8');
  }
}
```

### Database schema с TypeORM

Схема базы данных должна включать все необходимые поля для управления токенами и их автоматического обновления:

```typescript
import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('user_tokens')
@Index(['telegramUserId'], { unique: true })
export class UserToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;
  
  @Column({ type: 'bigint' })
  telegramUserId: number;
  
  @Column({ type: 'text' })
  encryptedAccessToken: string;
  
  @Column({ type: 'text' })
  encryptedRefreshToken: string;
  
  @Column({ type: 'timestamp' })
  tokenExpiresAt: Date;
  
  @Column({ type: 'simple-array', nullable: true })
  scopes: string[];
  
  @Column({ default: true })
  isActive: boolean;
  
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
  
  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  lastRefreshed: Date;
}
```

### Автоматическое обновление токенов

**Refresh access token за 5 минут до истечения** - это критически важная практика для бесшовного UX:

```typescript
class TokenStorageService {
  private encryptor: TokenEncryption;
  private repository: Repository<UserToken>;
  
  async getValidAccessToken(telegramUserId: number): Promise<string> {
    const tokenData = await this.repository.findOne({
      where: { telegramUserId, isActive: true }
    });
    
    if (!tokenData) {
      throw new Error('USER_NOT_AUTHENTICATED');
    }
    
    // Проверка: нужно ли обновить токен (5 минут до истечения)
    const bufferTime = 5 * 60 * 1000;
    const needsRefresh = Date.now() >= tokenData.tokenExpiresAt.getTime() - bufferTime;
    
    if (needsRefresh) {
      return await this.refreshAccessToken(telegramUserId);
    }
    
    return this.encryptor.decrypt(tokenData.encryptedAccessToken);
  }
  
  private async refreshAccessToken(telegramUserId: number): Promise<string> {
    const tokenData = await this.repository.findOne({
      where: { telegramUserId }
    });
    
    const refreshToken = this.encryptor.decrypt(tokenData.encryptedRefreshToken);
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET
    );
    
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      
      // Обновление в базе данных
      tokenData.encryptedAccessToken = this.encryptor.encrypt(
        credentials.access_token!
      );
      tokenData.tokenExpiresAt = new Date(credentials.expiry_date!);
      tokenData.lastRefreshed = new Date();
      
      await this.repository.save(tokenData);
      
      return credentials.access_token!;
    } catch (error: any) {
      if (error.response?.status === 400) {
        // Refresh token истёк или отозван - требуется повторная аутентификация
        tokenData.isActive = false;
        await this.repository.save(tokenData);
        throw new Error('REFRESH_TOKEN_INVALID');
      }
      throw error;
    }
  }
}
```

## Google Calendar API: полный обзор методов

Библиотека `googleapis` предоставляет полную TypeScript типизацию для Calendar API v3. Установка включает встроенные типы без необходимости в `@types` пакете:

```bash
npm install googleapis
```

### Базовая настройка клиента

```typescript
import { google, calendar_v3 } from 'googleapis';

class CalendarService {
  private calendar: calendar_v3.Calendar;
  
  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    
    this.calendar = google.calendar({ version: 'v3', auth });
  }
}
```

### events.list - получение событий с фильтрацией

Метод `events.list` поддерживает **разнообразные параметры фильтрации**, включая временные диапазоны, поиск по тексту и пагинацию:

```typescript
async listEvents(
  timeMin?: Date,
  timeMax?: Date,
  searchQuery?: string,
  maxResults: number = 250
): Promise<calendar_v3.Schema$Event[]> {
  const params: calendar_v3.Params$Resource$Events$List = {
    calendarId: 'primary',
    timeMin: timeMin?.toISOString(),
    timeMax: timeMax?.toISOString(),
    q: searchQuery,              // Поиск в summary, description, location
    singleEvents: true,          // Развернуть recurring events
    orderBy: 'startTime',        // Сортировка (требует singleEvents: true)
    maxResults: maxResults,      // Макс 2500
    showDeleted: false,
    timeZone: 'Europe/Moscow'
  };
  
  const response = await this.calendar.events.list(params);
  return response.data.items || [];
}
```

**Пагинация для больших датасетов** использует `pageToken`:

```typescript
async getAllEvents(): Promise<calendar_v3.Schema$Event[]> {
  const allEvents: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  
  do {
    const response = await this.calendar.events.list({
      calendarId: 'primary',
      maxResults: 250,
      pageToken: pageToken,
      singleEvents: true,
      orderBy: 'startTime'
    });
    
    if (response.data.items) {
      allEvents.push(...response.data.items);
    }
    
    pageToken = response.data.nextPageToken;
  } while (pageToken);
  
  return allEvents;
}
```

### events.insert - создание событий со всеми параметрами

Создание события поддерживает **богатый набор опций**: участники, напоминания, Google Meet конференции, вложения, повторяющиеся события:

```typescript
async createEvent(
  summary: string,
  start: Date,
  end: Date,
  options?: {
    description?: string;
    location?: string;
    attendees?: string[];
    reminders?: Array<{ method: 'email' | 'popup'; minutes: number }>;
    withGoogleMeet?: boolean;
    recurrence?: string[];
  }
): Promise<calendar_v3.Schema$Event> {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  
  const event: calendar_v3.Schema$Event = {
    summary: summary,
    description: options?.description,
    location: options?.location,
    
    start: {
      dateTime: start.toISOString(),
      timeZone: timeZone
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: timeZone
    },
    
    // Участники с настройками
    attendees: options?.attendees?.map(email => ({
      email: email,
      optional: false,
      responseStatus: 'needsAction'
    })),
    
    // Кастомные напоминания
    reminders: options?.reminders ? {
      useDefault: false,
      overrides: options.reminders
    } : {
      useDefault: true
    },
    
    // Google Meet конференция
    conferenceData: options?.withGoogleMeet ? {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' }
      }
    } : undefined,
    
    // Повторяющиеся события (RRULE)
    recurrence: options?.recurrence,
    
    // Дополнительные настройки
    visibility: 'default',
    transparency: 'opaque',
    guestsCanInviteOthers: true,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: true
  };
  
  const response = await this.calendar.events.insert({
    calendarId: 'primary',
    requestBody: event,
    conferenceDataVersion: options?.withGoogleMeet ? 1 : undefined,
    sendUpdates: 'all'  // Отправить email уведомления участникам
  });
  
  return response.data;
}
```

### Работа с recurring events (повторяющимися событиями)

Повторяющиеся события используют **RRULE формат из RFC 5545**. Ключевые компоненты:

```typescript
async createRecurringEvent(
  summary: string,
  startDate: Date,
  durationMinutes: number,
  recurrenceRule: string
): Promise<calendar_v3.Schema$Event> {
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
  
  const event: calendar_v3.Schema$Event = {
    summary: summary,
    start: {
      dateTime: startDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    end: {
      dateTime: endDate.toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
    },
    recurrence: [recurrenceRule]
  };
  
  return (await this.calendar.events.insert({
    calendarId: 'primary',
    requestBody: event
  })).data;
}
```

**Примеры RRULE правил**:

```typescript
// Каждый рабочий день в течение 30 дней
const weekdaysRule = 'RRULE:FREQ=WEEKLY;COUNT=30;BYDAY=MO,TU,WE,TH,FR';

// Каждый понедельник и среду, каждые 2 недели
const biweeklyRule = 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE';

// Последняя пятница каждого месяца
const lastFridayRule = 'RRULE:FREQ=MONTHLY;BYDAY=-1FR';

// Ежедневно до конца года
const dailyUntilRule = 'RRULE:FREQ=DAILY;UNTIL=20241231T235959Z';

// С исключениями (holidays)
const withExceptions = [
  'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR',
  'EXDATE;VALUE=DATE:20240325,20240401'  // Пропустить эти даты
];

// Использование
await createRecurringEvent(
  'Еженедельный созвон команды',
  new Date('2024-03-15T10:00:00'),
  60,
  weekdaysRule
);
```

### events.update vs events.patch - критическое различие

**events.update (PUT)** требует **полной замены объекта** - нужно отправить все поля события, иначе они будут удалены. **events.patch (PATCH)** является **частичным обновлением** и рекомендуется для большинства случаев:

```typescript
// ❌ НЕПРАВИЛЬНО: update без всех полей удалит остальные
async updateEventWrong(eventId: string) {
  await this.calendar.events.update({
    calendarId: 'primary',
    eventId: eventId,
    requestBody: { summary: 'Новое название' }  // location, attendees будут удалены!
  });
}

// ✅ ПРАВИЛЬНО: patch меняет только указанные поля
async updateEventCorrect(eventId: string) {
  await this.calendar.events.patch({
    calendarId: 'primary',
    eventId: eventId,
    requestBody: { summary: 'Новое название' },  // Остальное не меняется
    sendUpdates: 'all'
  });
}
```

### events.delete - удаление событий

```typescript
async deleteEvent(eventId: string, notifyAttendees: boolean = true) {
  await this.calendar.events.delete({
    calendarId: 'primary',
    eventId: eventId,
    sendUpdates: notifyAttendees ? 'all' : 'none'
  });
}
```

### Push notifications через webhooks

**Webhooks позволяют получать уведомления об изменениях** вместо постоянного polling. Настройка требует публичного HTTPS endpoint:

```typescript
async setupWebhook(webhookUrl: string): Promise<{
  channelId: string;
  resourceId: string;
  expiration: Date;
}> {
  const channelId = `channel-${Date.now()}`;
  
  const channel: calendar_v3.Schema$Channel = {
    id: channelId,
    type: 'web_hook',
    address: webhookUrl,
    token: crypto.randomBytes(32).toString('hex'),  // Для верификации
    expiration: Date.now() + (7 * 24 * 60 * 60 * 1000)  // Макс 7 дней
  };
  
  const response = await this.calendar.events.watch({
    calendarId: 'primary',
    requestBody: channel
  });
  
  return {
    channelId: channelId,
    resourceId: response.data.resourceId!,
    expiration: new Date(Number(response.data.expiration))
  };
}

async stopWebhook(channelId: string, resourceId: string) {
  await this.calendar.channels.stop({
    requestBody: {
      id: channelId,
      resourceId: resourceId
    }
  });
}
```

**Обработка webhook уведомлений на сервере**:

```typescript
app.post('/webhooks/calendar', async (req, res) => {
  const resourceState = req.headers['x-goog-resource-state'];
  const channelId = req.headers['x-goog-channel-id'];
  const resourceId = req.headers['x-goog-resource-id'];
  const token = req.headers['x-goog-channel-token'];
  
  // Верификация токена
  if (token !== expectedToken) {
    return res.status(401).send('Unauthorized');
  }
  
  // Обработка типов уведомлений
  switch (resourceState) {
    case 'sync':
      // Первое уведомление при настройке
      console.log('Webhook активирован');
      break;
      
    case 'exists':
      // Изменения в календаре - получить обновления
      await fetchCalendarChanges(channelId);
      break;
      
    case 'not_exists':
      // Календарь удалён
      break;
  }
  
  res.status(200).send('OK');
});
```

## Управление сессиями с iron-session

Iron-session идеально подходит для Telegram mini apps благодаря **stateless природе** и **serverless совместимости**. Сессии шифруются через signed + encrypted cookies:

```typescript
import { getIronSession, IronSessionOptions } from 'iron-session';

export interface SessionData {
  telegramUserId?: number;
  telegramUsername?: string;
  isAuthenticated?: boolean;
  googleConnected?: boolean;
  lastActivity?: number;
}

const sessionOptions: IronSessionOptions = {
  password: process.env.SESSION_SECRET!,  // Минимум 32 символа
  cookieName: 'tg_calendar_session',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',  // HTTPS only в production
    httpOnly: true,       // Недоступен из JavaScript
    sameSite: 'lax',
    maxAge: 14 * 24 * 60 * 60,  // 14 дней
    path: '/'
  }
};

// Использование в Express
import express from 'express';

const app = express();

app.post('/api/auth/telegram', async (req, res) => {
  const { initData } = req.body;
  
  // Валидация Telegram
  const userData = await authenticateTelegramUser(initData);
  
  // Создание сессии
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  session.telegramUserId = userData.id;
  session.telegramUsername = userData.username;
  session.isAuthenticated = true;
  session.lastActivity = Date.now();
  await session.save();
  
  res.json({ success: true });
});

// Middleware для проверки сессии
async function requireAuth(req: any, res: any, next: any) {
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  
  if (!session.isAuthenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  // Проверка активности (timeout сессии)
  const inactivityLimit = 30 * 60 * 1000;  // 30 минут
  if (Date.now() - (session.lastActivity || 0) > inactivityLimit) {
    session.destroy();
    return res.status(401).json({ error: 'Session expired' });
  }
  
  session.lastActivity = Date.now();
  await session.save();
  
  req.session = session;
  next();
}

// Защищённый endpoint
app.get('/api/calendar/events', requireAuth, async (req, res) => {
  const userId = req.session.telegramUserId;
  const events = await calendarService.listEvents(userId);
  res.json({ events });
});
```

### Альтернатива: stateless revalidation

Для максимальной простоты можно отправлять `initData` с каждым запросом и валидировать на сервере без сохранения сессий:

```typescript
// Frontend
const initData = window.Telegram.WebApp.initData;

fetch('/api/calendar/events', {
  method: 'GET',
  headers: {
    'Authorization': `tma ${initData}`
  }
});

// Backend middleware
async function telegramAuthMiddleware(req: any, res: any, next: any) {
  const auth = req.headers.authorization;
  
  if (!auth?.startsWith('tma ')) {
    return res.status(401).json({ error: 'No auth header' });
  }
  
  const initData = auth.substring(4);
  
  try {
    validate(initData, process.env.TELEGRAM_BOT_TOKEN!, { expiresIn: 3600 });
    const parsed = parse(initData);
    req.telegramUser = parsed.user;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid Telegram auth' });
  }
}
```

## Telegram Mini App integration: архитектура и best practices

Telegram mini apps - это **обычные веб-приложения**, работающие в WebView. Поддерживают любой фреймворк (React, Vue, Next.js) и требуют HTTPS в production.

### Инициализация mini app

```typescript
// index.html
<script src="https://telegram.org/js/telegram-web-app.js"></script>

// app.ts
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
      language_code?: string;
    };
    auth_date: number;
    hash: string;
  };
  ready: () => void;
  expand: () => void;
  close: () => void;
  MainButton: {
    text: string;
    color: string;
    textColor: string;
    isVisible: boolean;
    isActive: boolean;
    setText: (text: string) => void;
    show: () => void;
    hide: () => void;
    onClick: (callback: () => void) => void;
  };
  showAlert: (message: string) => void;
  showConfirm: (message: string, callback: (confirmed: boolean) => void) => void;
  openLink: (url: string) => void;
  sendData: (data: string) => void;
}

declare global {
  interface Window {
    Telegram: {
      WebApp: TelegramWebApp;
    };
  }
}

const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Доступ к данным пользователя
const userId = tg.initDataUnsafe.user?.id;
const username = tg.initDataUnsafe.user?.username;
```

### Реализация OAuth flow в mini app

```typescript
class CalendarIntegration {
  private tg = window.Telegram.WebApp;
  
  async connectGoogleCalendar() {
    // Показать подтверждение
    const confirmed = await new Promise<boolean>(resolve => {
      this.tg.showConfirm(
        'Вы будете перенаправлены в Google для авторизации. После предоставления доступа вернитесь в Telegram.',
        resolve
      );
    });
    
    if (!confirmed) return;
    
    // Запрос OAuth URL с сервера
    const response = await fetch('https://your-backend.com/api/auth/google/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `tma ${this.tg.initData}`
      },
      body: JSON.stringify({
        initData: this.tg.initData
      })
    });
    
    const { authUrl, authSessionId } = await response.json();
    
    // Сохранить session ID для polling
    localStorage.setItem('oauth_session_id', authSessionId);
    localStorage.setItem('oauth_pending', 'true');
    
    // Открыть OAuth в внешнем браузере
    this.tg.openLink(authUrl);
    
    // Начать polling для проверки завершения
    this.startAuthPolling(authSessionId);
  }
  
  private startAuthPolling(sessionId: string) {
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(
          `https://your-backend.com/api/auth/status/${sessionId}`,
          {
            headers: {
              'Authorization': `tma ${this.tg.initData}`
            }
          }
        );
        
        const { completed, success, error } = await response.json();
        
        if (completed) {
          clearInterval(pollInterval);
          localStorage.removeItem('oauth_pending');
          
          if (success) {
            this.tg.showAlert('✅ Google Calendar успешно подключён!');
            this.loadCalendarData();
          } else {
            this.tg.showAlert(`❌ Ошибка подключения: ${error}`);
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 2000);
    
    // Timeout через 5 минут
    setTimeout(() => {
      clearInterval(pollInterval);
      if (localStorage.getItem('oauth_pending') === 'true') {
        localStorage.removeItem('oauth_pending');
        this.tg.showAlert('⏱️ Время ожидания истекло. Попробуйте снова.');
      }
    }, 300000);
  }
  
  private async loadCalendarData() {
    const response = await fetch('https://your-backend.com/api/calendar/events', {
      headers: {
        'Authorization': `tma ${this.tg.initData}`
      }
    });
    
    const { events } = await response.json();
    this.renderEvents(events);
  }
}
```

### UX best practices для Telegram контекста

**Используйте MainButton для основных действий**:

```typescript
const mainButton = tg.MainButton;

mainButton.setText('Создать событие');
mainButton.color = '#0088cc';
mainButton.show();

mainButton.onClick(async () => {
  mainButton.setText('Создаю...');
  mainButton.showProgress();
  
  try {
    await createCalendarEvent();
    tg.showAlert('✅ Событие создано!');
  } catch (error) {
    tg.showAlert('❌ Ошибка создания события');
  } finally {
    mainButton.hideProgress();
    mainButton.setText('Создать событие');
  }
});
```

**Обработка возврата в приложение**:

```typescript
window.addEventListener('focus', async () => {
  // Проверить, не ожидаем ли OAuth завершения
  if (localStorage.getItem('oauth_pending') === 'true') {
    const sessionId = localStorage.getItem('oauth_session_id');
    if (sessionId) {
      // Сразу проверить статус
      await checkAuthStatus(sessionId);
    }
  }
});

// Проверка при загрузке приложения
window.addEventListener('DOMContentLoaded', async () => {
  // Продолжить polling если был прерван
  if (localStorage.getItem('oauth_pending') === 'true') {
    const sessionId = localStorage.getItem('oauth_session_id');
    if (sessionId) {
      startAuthPolling(sessionId);
    }
  }
  
  // Проверить статус подключения
  const connected = await checkGoogleConnection();
  if (connected) {
    loadCalendarData();
  } else {
    showConnectButton();
  }
});
```

## Security и Production: комплексная защита

### PKCE (Proof Key for Code Exchange) - обязательная защита

PKCE предотвращает атаки перехвата authorization code и **рекомендуется для ВСЕХ OAuth клиентов** по спецификации OAuth 2.1:

```typescript
class PKCEAuthFlow {
  generateCodeVerifier(): string {
    // 43-128 символов: base64url-encoded random string
    return crypto.randomBytes(32).toString('base64url');
  }
  
  generateCodeChallenge(verifier: string): string {
    // SHA-256 hash of verifier, base64url encoded
    return crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64url');
  }
  
  async initiateAuth(userId: string): Promise<string> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    const state = crypto.randomBytes(32).toString('hex');
    
    // Сохранить verifier временно (10 минут)
    await redis.setex(`pkce:${state}`, 600, codeVerifier);
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.events'],
      state: state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',  // SHA-256
      prompt: 'consent'
    });
  }
  
  async exchangeCode(code: string, state: string) {
    // Получить verifier
    const codeVerifier = await redis.get(`pkce:${state}`);
    if (!codeVerifier) {
      throw new Error('Invalid or expired PKCE session');
    }
    
    await redis.del(`pkce:${state}`);  // Одноразовое использование
    
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    
    // Exchange с code_verifier
    const { tokens } = await oauth2Client.getToken({
      code: code,
      codeVerifier: codeVerifier
    });
    
    return tokens;
  }
}
```

### Google OAuth Scopes - минимальные разрешения

**Запрашивайте только необходимые scopes** - пользователи охотнее соглашаются на ограниченные разрешения:

```typescript
// ✅ Только чтение событий (read-only бот)
const READ_ONLY_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events.readonly'
];

// ✅ Чтение и запись событий (рекомендуется для большинства случаев)
const EVENTS_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events'
];

// ✅ Полное управление календарями
const FULL_SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly'
];

// ❌ Избегайте полного доступа если не требуется
const AVOID = ['https://www.googleapis.com/auth/calendar'];
```

### Rate limiting на уровне приложения

Защита от злоупотреблений через **Redis-based rate limiting**:

```typescript
import { RateLimiterRedis } from 'rate-limiter-flexible';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

// Per-user rate limiter
const userRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_user',
  points: 30,           // 30 запросов
  duration: 60,         // За 60 секунд
  blockDuration: 60     // Блокировка на 60 секунд при превышении
});

// Global API rate limiter
const apiRateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl_api',
  points: 100,
  duration: 60
});

async function rateLimitMiddleware(req: any, res: any, next: any) {
  const userId = req.telegramUser?.id?.toString() || req.ip;
  
  try {
    await userRateLimiter.consume(userId);
    await apiRateLimiter.consume('global');
    next();
  } catch (rejRes: any) {
    const secs = Math.ceil(rejRes.msBeforeNext / 1000);
    res.set('Retry-After', String(secs));
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: secs
    });
  }
}
```

### Secrets management - НЕ используйте environment variables в production

Environment variables **видны в процессах, логах и дочерних процессах**. Используйте secrets manager:

```typescript
// AWS Secrets Manager
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });

async function getSecrets() {
  const command = new GetSecretValueCommand({
    SecretId: 'prod/telegram-calendar-bot'
  });
  
  const response = await client.send(command);
  const secrets = JSON.parse(response.SecretString!);
  
  return {
    googleClientId: secrets.GOOGLE_CLIENT_ID,
    googleClientSecret: secrets.GOOGLE_CLIENT_SECRET,
    telegramBotToken: secrets.TELEGRAM_BOT_TOKEN,
    tokenEncryptionKey: secrets.TOKEN_ENCRYPTION_KEY,
    sessionSecret: secrets.SESSION_SECRET
  };
}

// Google Cloud Secret Manager
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';

const secretClient = new SecretManagerServiceClient();

async function getSecret(name: string): Promise<string> {
  const [version] = await secretClient.accessSecretVersion({
    name: `projects/${PROJECT_ID}/secrets/${name}/versions/latest`
  });
  
  return version.payload!.data!.toString();
}
```

### Error handling для Calendar API

```typescript
async function callCalendarAPIWithRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      const status = error.response?.status;
      const reason = error.errors?.[0]?.reason;
      
      // Не повторять для этих ошибок
      if (status === 400 || status === 404 || status === 409) {
        throw error;
      }
      
      // 401 - refresh token
      if (status === 401) {
        await refreshUserToken();
        continue;
      }
      
      // 410 - sync token expired
      if (status === 410) {
        await clearSyncToken();
        continue;
      }
      
      // 403/429 - rate limit, экспоненциальный backoff
      if (status === 403 || status === 429) {
        if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;  // Другие 403 (permissions)
      }
      
      // 500/503 - server error, retry с backoff
      if (status === 500 || status === 503) {
        if (attempt < maxRetries - 1) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw new Error('Max retries exceeded');
}
```

## Production deployment: полная настройка

### Структура проекта и dependencies

```json
{
  "name": "telegram-calendar-bot",
  "version": "1.0.0",
  "scripts": {
    "dev": "ts-node-dev --respawn src/app.ts",
    "build": "tsc",
    "start": "node dist/app.js",
    "test": "jest",
    "lint": "eslint src/**/*.ts",
    "migration:run": "typeorm migration:run",
    "migration:generate": "typeorm migration:generate"
  },
  "dependencies": {
    "telegraf": "^4.16.3",
    "googleapis": "^128.0.0",
    "express": "^4.18.2",
    "@telegram-apps/init-data-node": "^0.0.8",
    "typeorm": "^0.3.17",
    "pg": "^8.11.3",
    "ioredis": "^5.3.2",
    "iron-session": "^8.0.1",
    "rate-limiter-flexible": "^4.0.1",
    "pino": "^8.16.2",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.10.0",
    "@types/express": "^4.17.21",
    "typescript": "^5.3.2",
    "ts-node-dev": "^2.0.0",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.1"
  }
}
```

### Docker setup для production

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:20-alpine

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3000

CMD ["node", "dist/app.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/calendar_bot
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped
    
  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: calendar_bot
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped
    
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Environment configuration с валидацией

```typescript
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().transform(Number).pipe(z.number().min(1).max(65535)),
  APP_URL: z.string().url(),
  
  TELEGRAM_BOT_TOKEN: z.string().regex(/^\d+:[A-Za-z0-9_-]{35}$/),
  
  GOOGLE_CLIENT_ID: z.string().endsWith('.apps.googleusercontent.com'),
  GOOGLE_CLIENT_SECRET: z.string().min(20),
  GOOGLE_REDIRECT_URI: z.string().url(),
  
  DATABASE_URL: z.string().startsWith('postgresql://'),
  REDIS_URL: z.string().startsWith('redis://'),
  
  TOKEN_ENCRYPTION_KEY: z.string().length(64),  // 32 bytes hex
  SESSION_SECRET: z.string().min(32)
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.format());
  process.exit(1);
}

export const config = parsed.data;
```

### Testing strategy

```typescript
// tests/calendar.test.ts
import { CalendarService } from '../src/calendar/client';

describe('CalendarService', () => {
  let service: CalendarService;
  
  beforeAll(() => {
    service = new CalendarService(TEST_ACCESS_TOKEN);
  });
  
  it('should list upcoming events', async () => {
    const events = await service.listUpcomingEvents(10);
    expect(events).toBeDefined();
    expect(Array.isArray(events)).toBe(true);
  });
  
  it('should create event with attendees', async () => {
    const event = await service.createEvent(
      'Test Event',
      new Date('2024-03-15T10:00:00'),
      new Date('2024-03-15T11:00:00'),
      {
        attendees: ['[email protected]'],
        reminders: [{ method: 'popup', minutes: 30 }]
      }
    );
    
    expect(event.summary).toBe('Test Event');
    expect(event.attendees).toHaveLength(1);
  });
  
  it('should handle rate limiting with backoff', async () => {
    const operation = jest.fn().mockRejectedValueOnce({
      response: { status: 429 },
      errors: [{ reason: 'rateLimitExceeded' }]
    }).mockResolvedValueOnce({ data: { items: [] } });
    
    const result = await callCalendarAPIWithRetry(operation);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
```

## Архитектурные рекомендации

### Рекомендуемый tech stack

- **Backend**: Node.js с TypeScript + Express
- **Bot Framework**: Telegraf 4.x
- **Calendar API**: googleapis npm package
- **Database**: PostgreSQL 15+ с TypeORM
- **Cache/Sessions**: Redis 7+
- **Authentication**: @telegram-apps/init-data-node + iron-session
- **Encryption**: Native Node.js crypto (AES-256-GCM)
- **Secrets**: AWS Secrets Manager или Google Cloud Secret Manager
- **Rate Limiting**: rate-limiter-flexible
- **Logging**: pino
- **Validation**: zod

### Критические security checklist

✅ **Валидация Telegram initData на каждом запросе** - HMAC-SHA-256 подпись  
✅ **OAuth state parameter** - хранить server-side в Redis с 10-минутным TTL  
✅ **PKCE для всех OAuth flows** - code_challenge + code_verifier  
✅ **Шифрование токенов** - AES-256-GCM перед сохранением в БД  
✅ **Secrets manager в production** - AWS/GCP/Azure, не environment variables  
✅ **Auto-refresh токенов** - за 5 минут до истечения  
✅ **Rate limiting** - per-user и global через Redis  
✅ **HTTPS везде** - Telegram webhook, OAuth callback, mini app  
✅ **Input validation** - zod schemas для всех внешних данных  
✅ **Error handling** - экспоненциальный backoff для Calendar API  
✅ **Logging без secrets** - никогда не логировать токены или чувствительные данные  
✅ **Database encryption at rest** - включить в production  
✅ **Minimum OAuth scopes** - запрашивать только необходимое  
✅ **Session timeout** - 30 минут неактивности  
✅ **Webhook verification** - токен в заголовках для Calendar webhooks

### Performance оптимизации

**Используйте sync tokens вместо повторных полных запросов**:

```typescript
async function incrementalSync(userId: string) {
  const syncToken = await getSyncToken(userId);
  
  const params: any = {
    calendarId: 'primary',
    showDeleted: true
  };
  
  if (syncToken) {
    params.syncToken = syncToken;
  } else {
    params.timeMin = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  }
  
  try {
    const response = await calendar.events.list(params);
    
    await saveSyncToken(userId, response.data.nextSyncToken);
    return response.data.items;
  } catch (error: any) {
    if (error.code === 410) {
      // Sync token expired - do full sync
      await clearSyncToken(userId);
      return incrementalSync(userId);
    }
    throw error;
  }
}
```

**Кэшируйте календарные данные в Redis**:

```typescript
async function getCachedEvents(userId: string): Promise<calendar_v3.Schema$Event[]> {
  const cached = await redis.get(`events:${userId}`);
  
  if (cached) {
    return JSON.parse(cached);
  }
  
  const events = await calendarService.listUpcomingEvents(userId);
  await redis.setex(`events:${userId}`, 300, JSON.stringify(events));  // 5 минут
  
  return events;
}
```

Эта архитектура обеспечивает **production-ready интеграцию** Google Calendar API с Telegram ботом, включая полную безопасность, управление токенами, обработку ошибок и масштабируемость.