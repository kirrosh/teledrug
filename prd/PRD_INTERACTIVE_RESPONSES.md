# PRD: Интерактивные ответы на команды пользователя

## 1. Обзор проекта

### Текущая ситуация

- **Проблема**: Бот отвечает статично - пользователь отправляет сообщение и получает только финальный результат
- **UX проблема**: Пользователь не знает, что происходит во время обработки запроса (особенно для долгих операций)
- **Отсутствие контекста**: Непонятно, какие инструменты/интеграции используются для выполнения задач
- **Технический долг**: В файле `src/core/bot-service.ts:129-133` происходит прямой вызов `agent.chat()` без промежуточной обратной связи

### Цель

Реализовать систему интерактивных ответов, которая:
1. Показывает пользователю процесс выполнения команды в реальном времени
2. Обновляет сообщения по мере продвижения задачи
3. Демонстрирует, какие интеграции/инструменты используются
4. Улучшает общее восприятие отзывчивости бота

## 2. Требования к функциональности

### 2.1 Пользовательские сценарии

**Сценарий 1: Проверка календаря**
```
Пользователь: "Что у меня в календаре на завтра?"

Сообщение бота (обновляется динамически):
🤔 Думаю...
↓
📅 Проверяю календарь...
↓
📊 Найдено 3 события на завтра:
• 09:00 - Встреча с командой
• 14:00 - Обед с партнерами
• 18:30 - Тренировка
```

**Сценарий 2: Создание события**
```
Пользователь: "Создай встречу с Петром на завтра в 15:00"

Сообщение бота (обновляется динамически):
🤔 Анализирую запрос...
↓
📝 Создаю событие в календаре...
↓
✅ Событие создано:
📅 Завтра, 15:00
👤 Встреча с Петром
```

**Сценарий 3: Сложная задача с несколькими этапами**
```
Пользователь: "Найди свободное время для встречи с Анной на следующей неделе"

Сообщение бота (обновляется динамически):
🤔 Анализирую запрос...
↓
📅 Проверяю календарь на следующую неделю...
↓
🔍 Ищу свободные промежутки...
↓
💡 Найдено 5 подходящих временных слотов:
• Понедельник, 10:00-11:00
• Вторник, 14:00-15:00
• Среда, 16:00-17:00
• Четверг, 11:00-12:00
• Пятница, 15:00-16:00
```

### 2.2 Технические требования

1. **Редактирование сообщений**: Использование `editMessageText` для обновления статуса
2. **Индикаторы прогресса**: Понятные эмодзи и текст для каждого этапа
3. **Типизация этапов**: Система статусов для разных типов операций
4. **Таймауты**: Защита от зависания в промежуточном состоянии
5. **Fallback**: Возможность откатиться к обычному ответу при ошибке

## 3. Архитектура решения

### 3.1 Новые компоненты

#### ResponseManager
```typescript
// src/core/response-manager.ts
export interface ProgressStep {
  type: 'thinking' | 'processing' | 'tool_call' | 'result';
  message: string;
  emoji: string;
  metadata?: {
    toolName?: string;
    integration?: string;
    progress?: number; // 0-100%
  };
}

export class ResponseManager {
  private activeResponses = new Map<number, {
    messageId: number;
    currentStep: ProgressStep;
    history: ProgressStep[];
  }>();

  async startProgress(ctx: Context, initialStep: ProgressStep): Promise<void> {
    const response = await ctx.reply(
      `${initialStep.emoji} ${initialStep.message}`
    );

    this.activeResponses.set(ctx.chat!.id, {
      messageId: response.message_id,
      currentStep: initialStep,
      history: [initialStep]
    });
  }

  async updateProgress(
    ctx: Context,
    step: ProgressStep,
    keepHistory: boolean = false
  ): Promise<void> {
    const chatId = ctx.chat!.id;
    const activeResponse = this.activeResponses.get(chatId);

    if (!activeResponse) return;

    let messageText = `${step.emoji} ${step.message}`;

    if (keepHistory) {
      const historyText = activeResponse.history
        .map(s => `${s.emoji} ${s.message}`)
        .join('\n');
      messageText = `${historyText}\n${step.emoji} ${step.message}`;
    }

    await ctx.api.editMessageText(
      chatId,
      activeResponse.messageId,
      messageText
    );

    activeResponse.currentStep = step;
    activeResponse.history.push(step);
  }

  async finishProgress(ctx: Context, finalResult: string): Promise<void> {
    const chatId = ctx.chat!.id;
    const activeResponse = this.activeResponses.get(chatId);

    if (!activeResponse) {
      // Fallback - отправляем новое сообщение
      await ctx.reply(finalResult);
      return;
    }

    await ctx.api.editMessageText(
      chatId,
      activeResponse.messageId,
      finalResult
    );

    this.activeResponses.delete(chatId);
  }
}
```

#### Enhanced AI Agent
```typescript
// src/ai/agent.ts (модификация существующего)
export interface ProgressCallback {
  onThinking?: () => Promise<void>;
  onToolCall?: (toolName: string) => Promise<void>;
  onToolResult?: (toolName: string, result: any) => Promise<void>;
}

export class AIAgent {
  // ... существующий код ...

  async chatWithProgress(
    userMessage: string,
    conversationHistory?: string[],
    progressCallback?: ProgressCallback
  ): Promise<GenerateTextResult<Record<string, any>, any>> {
    try {
      // Уведомляем о начале обработки
      if (progressCallback?.onThinking) {
        await progressCallback.onThinking();
      }

      const systemPrompt = this.buildSystemPrompt();
      const messages = this.buildConversationMessages(
        systemPrompt,
        userMessage,
        conversationHistory
      );

      const result = await generateText({
        model: openai(this.config.model || "gpt-5-nano"),
        messages,
        tools: this.tools,
        onStepFinish: async (step) => {
          // Отслеживаем вызовы инструментов
          if (step.stepType === 'tool-call' && progressCallback?.onToolCall) {
            await progressCallback.onToolCall(step.toolCallId);
          }
          if (step.stepType === 'tool-result' && progressCallback?.onToolResult) {
            await progressCallback.onToolResult(step.toolCallId, step.result);
          }
        }
      });

      // Обрабатываем результат
      if (!result.text && result.toolCalls && result.toolResults) {
        const formattedResponse = this.formatToolResults(result);
        return {
          ...result,
          text: formattedResponse,
        };
      }

      return result;
    } catch (error) {
      console.error("Ошибка в AI агенте:", error);
      throw new Error(`Ошибка обработки запроса: ${error}`);
    }
  }
}
```

### 3.2 Интеграция с bot-service

```typescript
// src/core/bot-service.ts (модификация)
export class BotService {
  private responseManager: ResponseManager;

  constructor(config: BotServiceConfig) {
    // ... существующий код ...
    this.responseManager = new ResponseManager();
  }

  private async handleTextMessage(
    ctx: Context,
    text: string,
    history: string[]
  ): Promise<void> {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;

    if (!userId) {
      await ctx.reply("❌ Не удалось определить пользователя");
      return;
    }

    try {
      console.log(`📝 Обработка сообщения от ${username} (${userId}): ${text}`);

      // Получаем или создаем пользователя
      await this.userManager.getOrCreateUser(userId, username);

      // Получаем AI агента для пользователя
      const agent = await this.aiAgentFactory.getOrCreateAgent(userId);

      // Определяем тип запроса и соответствующие этапы
      const progressSteps = this.determineProgressSteps(text);

      // Начинаем прогресс
      await this.responseManager.startProgress(ctx, progressSteps.initial);

      // Обрабатываем сообщение с колбэками прогресса
      const result = await agent.chatWithProgress(text, history, {
        onThinking: async () => {
          await this.responseManager.updateProgress(ctx, progressSteps.thinking);
        },
        onToolCall: async (toolName: string) => {
          const step = this.mapToolToProgressStep(toolName);
          await this.responseManager.updateProgress(ctx, step);
        },
        onToolResult: async (toolName: string, result: any) => {
          // Опционально можно обновить прогресс после получения результата
        }
      });

      if (result) {
        const responseText = result.text || "Задача выполнена!";
        await this.responseManager.finishProgress(ctx, responseText);

        // Сохраняем ответ в историю
        if (ctx.chat?.id) {
          this.telegramBot.addAssistantResponse(ctx.chat.id, responseText);
        }
      } else {
        await this.responseManager.finishProgress(
          ctx,
          "❌ Не удалось получить ответ от AI агента"
        );
      }
    } catch (error) {
      console.error("Ошибка при обработке сообщения:", error);
      await this.responseManager.finishProgress(
        ctx,
        `❌ Произошла ошибка: ${error}`
      );
    }
  }

  private determineProgressSteps(text: string) {
    // Анализируем текст запроса и определяем подходящие этапы
    const lowerText = text.toLowerCase();

    if (lowerText.includes('календар') || lowerText.includes('событи') ||
        lowerText.includes('встреч') || lowerText.includes('время')) {
      return {
        initial: {
          type: 'thinking' as const,
          message: 'Думаю...',
          emoji: '🤔'
        },
        thinking: {
          type: 'thinking' as const,
          message: 'Анализирую запрос...',
          emoji: '🧠'
        },
      };
    }

    return {
      initial: { type: 'thinking' as const, message: 'Думаю...', emoji: '🤔' },
      thinking: { type: 'processing' as const, message: 'Обрабатываю...', emoji: '⚙️' },
    };
  }

  private mapToolToProgressStep(toolName: string): ProgressStep {
    const toolMappings: Record<string, ProgressStep> = {
      'calendar_get_events': {
        type: 'tool_call',
        message: 'Проверяю календарь...',
        emoji: '📅',
        metadata: { toolName, integration: 'YandexCalendar' }
      },
      'calendar_create_event': {
        type: 'tool_call',
        message: 'Создаю событие в календаре...',
        emoji: '📝',
        metadata: { toolName, integration: 'YandexCalendar' }
      },
      'calendar_find_free_time': {
        type: 'tool_call',
        message: 'Ищу свободное время...',
        emoji: '🔍',
        metadata: { toolName, integration: 'YandexCalendar' }
      }
    };

    return toolMappings[toolName] || {
      type: 'tool_call',
      message: 'Выполняю операцию...',
      emoji: '⚙️',
      metadata: { toolName }
    };
  }
}
```

## 4. План реализации

### Фаза 1: Базовый ResponseManager (1-2 дня)
1. ✅ Создать `ResponseManager` класс
2. ✅ Реализовать методы `startProgress`, `updateProgress`, `finishProgress`
3. ✅ Добавить систему типизации для этапов
4. ✅ Написать базовые тесты

### Фаза 2: Интеграция с AI Agent (2-3 дня)
1. ✅ Модифицировать `AIAgent` для поддержки колбэков прогресса
2. ✅ Добавить отслеживание вызовов инструментов
3. ✅ Реализовать `chatWithProgress` метод
4. ✅ Обеспечить совместимость с существующим API

### Фаза 3: Модификация BotService (1-2 дня)
1. ✅ Интегрировать `ResponseManager` в `BotService`
2. ✅ Реализовать логику определения типа запроса
3. ✅ Создать маппинг инструментов к этапам прогресса
4. ✅ Добавить обработку ошибок и fallback

### Фаза 4: Тонкая настройка и тестирование (2-3 дня)
1. ✅ Добавить специфичные сообщения для разных интеграций
2. ✅ Реализовать таймауты и защиту от зависания
3. ✅ Протестировать на различных сценариях
4. ✅ Оптимизировать частоту обновлений

### Фаза 5: Расширенные возможности (опционально)
1. 🔄 Добавить индикаторы прогресса в процентах
2. 🔄 Реализовать историю этапов в одном сообщении
3. 🔄 Добавить эмодзи-анимации для длительных операций
4. 🔄 Интегрировать с системой аналитики

## 5. Технические детали

### 5.1 Ограничения Telegram Bot API

1. **Rate Limits**:
   - Редактирование сообщений: максимум 30 раз в минуту на чат
   - Интервал между редактированиями: минимум 1 секунда

2. **Message Limits**:
   - Максимум 4096 символов в сообщении
   - Markdown/HTML форматирование ограничено

### 5.2 Обработка ошибок

```typescript
// src/core/response-manager.ts
export class ResponseManager {
  private readonly MAX_EDIT_ATTEMPTS = 3;
  private readonly EDIT_RETRY_DELAY = 1000; // 1 секунда

  async updateProgress(ctx: Context, step: ProgressStep): Promise<void> {
    let attempts = 0;

    while (attempts < this.MAX_EDIT_ATTEMPTS) {
      try {
        // ... код редактирования сообщения ...
        return;
      } catch (error) {
        attempts++;

        if (error.error_code === 429) {
          // Too Many Requests - ждем и пробуем снова
          await this.delay(this.EDIT_RETRY_DELAY * attempts);
        } else if (error.error_code === 400 &&
                   error.description?.includes('message is not modified')) {
          // Сообщение не изменилось - это OK
          return;
        } else if (attempts >= this.MAX_EDIT_ATTEMPTS) {
          console.error('Failed to update progress after retries:', error);
          // Fallback - отправляем новое сообщение
          await ctx.reply(`${step.emoji} ${step.message}`);
          return;
        }
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 5.3 Конфигурация

```typescript
// src/config/interactive-responses.ts
export const InteractiveResponsesConfig = {
  // Включить/выключить интерактивные ответы глобально
  enabled: process.env.INTERACTIVE_RESPONSES_ENABLED !== 'false',

  // Минимальная задержка между обновлениями (мс)
  minUpdateDelay: parseInt(process.env.MIN_UPDATE_DELAY || '1000'),

  // Максимальное время жизни прогресса (мс)
  maxProgressDuration: parseInt(process.env.MAX_PROGRESS_DURATION || '30000'),

  // Показывать ли историю этапов в сообщении
  showProgressHistory: process.env.SHOW_PROGRESS_HISTORY === 'true',

  // Специфичные настройки для разных типов запросов
  stepMappings: {
    calendar: {
      thinking: { emoji: '🤔', message: 'Анализирую запрос...' },
      checking: { emoji: '📅', message: 'Проверяю календарь...' },
      creating: { emoji: '📝', message: 'Создаю событие...' },
      searching: { emoji: '🔍', message: 'Ищу подходящее время...' }
    },
    general: {
      thinking: { emoji: '🤔', message: 'Думаю...' },
      processing: { emoji: '⚙️', message: 'Обрабатываю...' }
    }
  }
};
```

## 6. Метрики и мониторинг

### 6.1 KPI для измерения успеха

1. **Пользовательские метрики**:
   - Время ответа системы (субъективное восприятие)
   - Количество запросов "что происходит?" (должно снизиться)
   - Общий NPS/удовлетворенность пользователей

2. **Технические метрики**:
   - Процент успешных обновлений прогресса (>95%)
   - Среднее количество этапов на запрос
   - Время между этапами прогресса
   - Частота fallback на обычные ответы (<5%)

### 6.2 Логирование

```typescript
// src/core/response-manager.ts
export class ResponseManager {
  private logger = console; // Можно заменить на полноценный логгер

  async updateProgress(ctx: Context, step: ProgressStep): Promise<void> {
    const chatId = ctx.chat!.id;

    this.logger.info('Progress update', {
      chatId,
      stepType: step.type,
      message: step.message,
      metadata: step.metadata,
      timestamp: new Date().toISOString()
    });

    // ... основная логика ...
  }
}
```

## 7. Безопасность и производительность

### 7.1 Защита от спама

```typescript
// src/core/rate-limiter.ts
export class ProgressRateLimiter {
  private chatUpdates = new Map<number, number[]>();
  private readonly MAX_UPDATES_PER_MINUTE = 10;

  canUpdate(chatId: number): boolean {
    const now = Date.now();
    const updates = this.chatUpdates.get(chatId) || [];

    // Удаляем старые записи (старше 1 минуты)
    const recentUpdates = updates.filter(time => now - time < 60000);

    if (recentUpdates.length >= this.MAX_UPDATES_PER_MINUTE) {
      return false;
    }

    recentUpdates.push(now);
    this.chatUpdates.set(chatId, recentUpdates);
    return true;
  }
}
```

### 7.2 Очистка памяти

```typescript
// src/core/response-manager.ts
export class ResponseManager {
  private readonly CLEANUP_INTERVAL = 300000; // 5 минут

  constructor() {
    // Периодическая очистка заброшенных responses
    setInterval(() => this.cleanup(), this.CLEANUP_INTERVAL);
  }

  private cleanup(): void {
    const now = Date.now();

    for (const [chatId, response] of this.activeResponses.entries()) {
      // Если response старше 30 минут - удаляем
      if (now - response.startTime > 1800000) {
        this.activeResponses.delete(chatId);
        console.warn(`Cleaned up stale response for chat ${chatId}`);
      }
    }
  }
}
```

## 8. Будущие улучшения

### 8.1 Краткосрочные (1-2 месяца)
1. **Персонализация**: Адаптация сообщений под предпочтения пользователя
2. **Эмодзи-анимации**: Вращающиеся/меняющиеся эмодзи для длительных операций
3. **Прогресс-бары**: Текстовые индикаторы прогресса для задач с известной длительностью

### 8.2 Долгосрочные (3+ месяца)
1. **Голосовые уведомления**: Интеграция с Telegram Voice Messages
2. **Веб-интерфейс**: Dashboard для мониторинга активных задач
3. **ML-предсказания**: Прогнозирование времени выполнения операций
4. **Батчинг**: Группировка множественных этапов в одно обновление

## 9. Риски и митигации

| Риск | Вероятность | Влияние | Митигация |
|------|-------------|---------|-----------|
| Rate limiting от Telegram | Средняя | Высокое | Реализация очередей и retry логики |
| Зависание в промежуточном состоянии | Низкая | Среднее | Таймауты и автоматическая очистка |
| Ухудшение производительности | Средняя | Среднее | Профилирование и оптимизация |
| Путаница пользователей от частых обновлений | Низкая | Низкое | A/B тестирование частоты обновлений |

## 10. Заключение

Реализация интерактивных ответов значительно улучшит пользовательский опыт взаимодействия с ботом за счет:

1. **Прозрачности**: Пользователи видят, что происходит с их запросом
2. **Отзывчивости**: Мгновенная обратная связь вместо долгого ожидания
3. **Контекста**: Понимание того, какие интеграции используются
4. **Профессионализма**: Бот кажется более "живым" и продвинутым

Предлагаемая архитектура обеспечивает:
- Обратную совместимость с существующим кодом
- Гибкость настройки для разных типов операций
- Устойчивость к ошибкам и сбоям
- Возможность дальнейшего расширения функциональности

Рекомендуется начать с базовой реализации (Фазы 1-3) и постепенно добавлять расширенные возможности на основе обратной связи пользователей.