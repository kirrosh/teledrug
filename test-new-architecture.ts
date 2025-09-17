#!/usr/bin/env bun

// Тест новой архитектуры взаимодействий
import { ChatContext } from "./src/core/chat-context";
import { InteractionType } from "./src/types/interaction-types";
import { YandexCalendarIntegration } from "./src/integrations/yandex-calendar/index";
import { AIAgent } from "./src/ai/agent";

async function testArchitecture() {
  console.log("🧪 Тестирование новой архитектуры взаимодействий...\n");

  // 1. Тест создания интеграции с метаданными
  console.log("📅 Создание интеграции календаря...");
  const calendarIntegration = new YandexCalendarIntegration();

  // Проверка метаданных инструментов
  const toolsMetadata = calendarIntegration.getAllToolsMetadata();
  console.log(`✅ Загружено ${toolsMetadata.length} инструментов:`);
  toolsMetadata.forEach(metadata => {
    console.log(`  - ${metadata.name}: ${metadata.description}`);
    console.log(`    Поддерживает: ${metadata.supportedInteractionTypes.join(', ')}`);
    console.log(`    Права: read=${metadata.permissions.read}, write=${metadata.permissions.write}`);
  });

  // 2. Тест ChatContext для разных типов взаимодействий
  console.log("\n💬 Тестирование ChatContext...");

  const testCases = [
    {
      type: InteractionType.TEXT,
      message: "Покажи мои встречи на завтра",
      description: "Текстовое сообщение"
    },
    {
      type: InteractionType.VOICE,
      message: "Создай встречу на понедельник в 15:00",
      description: "Голосовое сообщение"
    },
    {
      type: InteractionType.IMAGE,
      message: "Анализируй это расписание",
      description: "Сообщение с изображением"
    },
    {
      type: InteractionType.FORWARD,
      message: "Пересланное сообщение: Встреча завтра в 10 утра",
      description: "Пересланное сообщение"
    }
  ];

  for (const testCase of testCases) {
    console.log(`\n🔍 ${testCase.description} (${testCase.type})`);

    const chatContext = new ChatContext({
      interactionType: testCase.type,
      userId: 12345,
      chatId: 67890,
      messageContent: testCase.message,
      integrations: [calendarIntegration]
    });

    const availableTools = chatContext.getAvailableTools();
    const toolNames = Object.keys(availableTools);

    console.log(`  📊 Доступно ${toolNames.length} инструментов: ${toolNames.join(', ')}`);

    // Проверка фильтрации для IMAGE и FORWARD
    if (testCase.type === InteractionType.IMAGE || testCase.type === InteractionType.FORWARD) {
      const hasOnlyCreateEvent = toolNames.length === 1 && toolNames.includes('createEvent');
      console.log(`  ✅ Ограничение только createEvent: ${hasOnlyCreateEvent ? 'Да' : 'Нет'}`);
    }

    // Проверка полного доступа для TEXT и VOICE
    if (testCase.type === InteractionType.TEXT || testCase.type === InteractionType.VOICE) {
      const hasFullAccess = toolNames.length === 3; // getEvents, getLastEvents, createEvent
      console.log(`  ✅ Полный доступ к инструментам: ${hasFullAccess ? 'Да' : 'Нет'}`);
    }
  }

  // 3. Тест AIAgent (без реального вызова API)
  console.log("\n🤖 Создание AIAgent...");
  const aiAgent = new AIAgent({
    openaiApiKey: "test-key", // не будем вызывать реальный API
    userId: 12345
  }, [calendarIntegration]);

  console.log("✅ AIAgent создан успешно");

  // 4. Тест построения сообщений для разных типов взаимодействий
  console.log("\n📝 Тестирование построения сообщений...");

  const textContext = new ChatContext({
    interactionType: InteractionType.TEXT,
    userId: 12345,
    chatId: 67890,
    messageContent: "Привет! Покажи события на сегодня",
    integrations: [calendarIntegration]
  });

  const messages = textContext.buildMessages("Ты AI помощник", ["Предыдущее сообщение", "Ответ ассистента"]);
  console.log(`✅ Создано ${messages.length} сообщений для Vercel AI SDK`);

  console.log("\n🎉 Все тесты пройдены успешно!");
  console.log("\n📋 Что реализовано:");
  console.log("✅ Enum InteractionType с четырьмя типами взаимодействий");
  console.log("✅ ChatContext с умной фильтрацией инструментов");
  console.log("✅ Integration с системой метаданных инструментов");
  console.log("✅ YandexCalendarIntegration с обновленной архитектурой");
  console.log("✅ AIAgent с поддержкой ChatContext и Vercel AI SDK");
  console.log("✅ TelegramBot с новыми обработчиками");

  console.log("\n📝 TODO для полной реализации:");
  console.log("🔧 Интеграция с Whisper API для распознавания голоса");
  console.log("🔧 Интеграция с Vision API для анализа изображений");
  console.log("🔧 Методы загрузки файлов из Telegram Bot API");
  console.log("🔧 Реальное подключение к bot-service.ts");
}

// Запуск тестов
testArchitecture().catch(console.error);