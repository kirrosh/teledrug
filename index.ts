import {
  YandexCalendarService,
  type CalendarEvent,
} from "./yandex-calendar-service";

async function main() {
  const calendarUrl =
    "https://caldav.yandex.ru/calendars/koshelevkirill1992%40yandex.ru/events-5649327/";
  const username = "koshelevkirill1992@yandex.ru";
  const password = "REMOVED"; // замените на ваш пароль приложения

  const calendarService = new YandexCalendarService(
    calendarUrl,
    username,
    password
  );

  try {
    console.log("Инициализация сервиса календаря...");
    await calendarService.initialize();

    console.log("Создание тестового события...");
    const newEvent: CalendarEvent = {
      summary: "Тестовое событие",
      description: "Это тестовое событие, созданное через CalDAV API",
      startDate: new Date(Date.now() + 60 * 60 * 1000), // через час
      endDate: new Date(Date.now() + 2 * 60 * 60 * 1000), // через 2 часа
      location: "Онлайн",
    };

    const eventId = await calendarService.createEvent(newEvent);
    console.log(`Событие создано с ID: ${eventId}`);

    console.log("Получение списка событий...");
    const events = await calendarService.getEvents();
    console.log(`Найдено событий: ${events.length}`);

    events.forEach((event, index) => {
      console.log(`Событие ${index + 1}:`);
      console.log(`  ID: ${event.id}`);
      console.log(`  Название: ${event.summary}`);
      console.log(`  Описание: ${event.description || "Не указано"}`);
      console.log(`  Начало: ${event.startDate.toISOString()}`);
      console.log(`  Конец: ${event.endDate.toISOString()}`);
      console.log(`  Место: ${event.location || "Не указано"}`);
      console.log("---");
    });
  } catch (error) {
    console.error("Ошибка:", error);
  }
}

main();
