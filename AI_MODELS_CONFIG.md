# Конфигурация моделей OpenAI

Этот документ описывает, как настроить модели OpenAI для бота TeleDrug.

## Обзор

Все модели OpenAI теперь настраиваются централизованно через переменные окружения. Это позволяет легко переключаться между различными моделями без изменения кода.

## Переменные окружения

### `OPENAI_MODEL`

**Назначение:** Основная модель для AI агентов, анализа и генерации текста

**Значение по умолчанию:** `gpt-4o-mini`

**Где используется:**
- AI-оркестратор и маршрутизатор агентов
- Анализ дневниковых записей (настроение, энергия, теги)
- Извлечение задач из дневниковых записей
- Анализ изображений
- Пользовательские настройки

**Пример:**
```bash
OPENAI_MODEL=gpt-4o
# или
OPENAI_MODEL=gpt-4-turbo
# или
OPENAI_MODEL=gpt-4o-mini  # по умолчанию
```

### `OPENAI_TRANSCRIPTION_MODEL`

**Назначение:** Модель для транскрипции аудио и голосовых сообщений

**Значение по умолчанию:** `gpt-4o-mini-transcribe`

**Где используется:**
- Транскрипция голосовых сообщений в Telegram
- Транскрипция аудиофайлов

**Пример:**
```bash
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe  # по умолчанию
```

## Настройка

### 1. Через файл .env

Создайте или отредактируйте файл `.env` в корне проекта:

```env
# OpenAI API ключ (обязательно)
OPENAI_API_KEY=sk-...

# Основная модель (опционально, по умолчанию gpt-4o-mini)
OPENAI_MODEL=gpt-4o-mini

# Модель для транскрипции (опционально, по умолчанию gpt-4o-mini-transcribe)
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

### 2. Через переменные окружения системы

**Linux/macOS:**
```bash
export OPENAI_MODEL=gpt-4o
export OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

**Windows (PowerShell):**
```powershell
$env:OPENAI_MODEL = "gpt-4o"
$env:OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
```

### 3. Через Docker Compose

```yaml
services:
  bot:
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_MODEL=gpt-4o-mini
      - OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Рекомендуемые модели

### Для продакшена

**Бюджетный вариант (рекомендуется):**
```env
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

**Улучшенное качество:**
```env
OPENAI_MODEL=gpt-4o
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

**Максимальное качество:**
```env
OPENAI_MODEL=gpt-4-turbo
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

### Для разработки

```env
# Дешевле и быстрее для тестирования
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Сравнение моделей

| Модель | Скорость | Стоимость | Качество | Рекомендация |
|--------|----------|-----------|----------|--------------|
| `gpt-4o-mini` | ⚡⚡⚡ | 💰 | ⭐⭐⭐ | Оптимально для большинства задач |
| `gpt-4o` | ⚡⚡ | 💰💰 | ⭐⭐⭐⭐ | Для более сложных задач |
| `gpt-4-turbo` | ⚡ | 💰💰💰 | ⭐⭐⭐⭐⭐ | Максимальное качество |

## Архитектура

### Централизованная конфигурация

Конфигурация находится в файле:
```
packages/core/src/config/ai-models.ts
```

**Функции:**
- `getMainModel()` - получить основную модель
- `getTranscriptionModel()` - получить модель транскрипции

### Использование в коде

Все компоненты используют централизованную конфигурацию:

```typescript
import { getMainModel, getTranscriptionModel } from "../config/ai-models";

// Для основных задач
const model = openai(getMainModel());

// Для транскрипции
const transcriptionModel = openai.transcription(getTranscriptionModel());
```

### Затронутые компоненты

1. **packages/ai/src/contracts/config.ts** - схема конфигурации AI агента
2. **packages/core/src/services/journal-analysis.ts** - анализ дневниковых записей
3. **packages/core/src/journal/tools.ts** - извлечение задач из журнала
4. **packages/core/src/app/layers/main.ts** - основной слой приложения
5. **packages/core/src/bot/telegram/image-analyzer.ts** - анализ изображений
6. **packages/core/src/services/user-config-storage.ts** - хранилище конфигурации пользователя
7. **packages/core/src/bot/telegram/audio-transcriber.ts** - транскрипция аудио

## Мониторинг стоимости

### Примерная стоимость (на 1000 запросов)

**gpt-4o-mini:**
- Input: ~$0.15 / 1M токенов
- Output: ~$0.60 / 1M токенов

**gpt-4o:**
- Input: ~$2.50 / 1M токенов
- Output: ~$10.00 / 1M токенов

**gpt-4-turbo:**
- Input: ~$10.00 / 1M токенов
- Output: ~$30.00 / 1M токенов

### Рекомендации по оптимизации

1. **Используйте gpt-4o-mini для большинства задач** - отличное соотношение цена/качество
2. **Переключайтесь на более мощные модели только при необходимости**
3. **Мониторьте использование через OpenAI Dashboard**
4. **Настройте лимиты токенов** в конфигурации (параметр `maxTokens`)

## Миграция с хардкода

Если вы использовали старую версию с хардкодом моделей, миграция не требуется:

- ✅ Все значения по умолчанию остались прежними (`gpt-4o-mini`)
- ✅ Бот продолжит работать без изменений
- ✅ Вы можете настроить модели через переменные окружения в любой момент

## Устранение проблем

### Модель не меняется

**Проблема:** Переменная окружения установлена, но бот использует старую модель

**Решение:**
1. Проверьте, что переменная окружения доступна:
   ```bash
   echo $OPENAI_MODEL
   ```
2. Перезапустите бота после изменения переменных
3. Убедитесь, что .env файл загружается корректно

### Ошибка "Invalid model"

**Проблема:** OpenAI API возвращает ошибку о неподдерживаемой модели

**Решение:**
1. Проверьте, что название модели корректное
2. Убедитесь, что у вас есть доступ к этой модели в OpenAI
3. Проверьте актуальный список моделей: https://platform.openai.com/docs/models

### Высокие затраты

**Проблема:** Использование API обходится слишком дорого

**Решение:**
1. Переключитесь на `gpt-4o-mini` - она в 10-20 раз дешевле
2. Уменьшите `maxTokens` в конфигурации
3. Настройте rate limiting
4. Мониторьте использование в OpenAI Dashboard

## Примеры конфигурации

### Минимальная конфигурация
```env
OPENAI_API_KEY=sk-...
# Все остальное по умолчанию
```

### Оптимальная конфигурация
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

### Продвинутая конфигурация
```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Дополнительные ресурсы

- [OpenAI Models Documentation](https://platform.openai.com/docs/models)
- [OpenAI Pricing](https://openai.com/pricing)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

## Обратная связь

Если у вас есть вопросы или предложения по конфигурации моделей, создайте issue в репозитории проекта.
