/**
 * Централизованная конфигурация моделей OpenAI
 *
 * Все модели можно настроить через переменные окружения:
 * - OPENAI_MODEL - основная модель для AI агентов (по умолчанию: gpt-4o-mini)
 * - OPENAI_TRANSCRIPTION_MODEL - модель для транскрипции аудио (по умолчанию: gpt-4o-mini-transcribe)
 */

export const AI_MODELS = {
  /**
   * Основная модель для AI агентов, анализа и генерации текста
   */
  main: process.env.OPENAI_MODEL || "gpt-4o-mini",

  /**
   * Модель для транскрипции аудио и голосовых сообщений
   */
  transcription:
    process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe",
} as const;

/**
 * Получить название основной модели
 */
export const getMainModel = (): string => AI_MODELS.main;

/**
 * Получить название модели для транскрипции
 */
export const getTranscriptionModel = (): string => AI_MODELS.transcription;
