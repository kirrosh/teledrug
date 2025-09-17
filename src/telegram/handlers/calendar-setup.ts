import type { Context } from "grammy";
import { UserRepository } from "../../storage/database/repositories/user-repository";
import { createDAVClient } from "tsdav";

interface SetupSession {
  step: "url" | "password";
  data: {
    url?: string;
    username?: string;
    password?: string;
  };
}

export class CalendarSetupHandler {
  private setupSessions = new Map<number, SetupSession>();
  private userRepository = new UserRepository();

  async handleAddYandexCalendar(ctx: Context) {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Start setup session
    this.setupSessions.set(userId, {
      step: "url",
      data: {},
    });

    await ctx.reply(
      "📅 Настройка календаря Яндекс\n\n" +
        "Шаг 1/2: Введите URL вашего календаря CalDAV\n" +
        "Пример: https://caldav.yandex.ru/calendars/username@yandex.ru/events-xxx/\n\n" +
        "Email будет извлечен автоматически из URL\n\n" +
        "Для отмены введите /cancel"
    );
  }

  async handleUserMessage(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const session = this.setupSessions.get(userId);
    if (!session) return false;

    if (text === "/cancel") {
      this.setupSessions.delete(userId);
      await ctx.reply("❌ Настройка отменена");
      return true;
    }

    switch (session.step) {
      case "url":
        if (!this.validateCalDAVUrl(text)) {
          await ctx.reply("❌ Неверный формат URL. Попробуйте еще раз.");
          return true;
        }

        // Extract username from URL
        const username = this.extractUsernameFromUrl(text);
        if (!username) {
          await ctx.reply(
            "❌ Не удалось извлечь email из URL.\n" +
              "URL должен содержать email в формате: /calendars/email@yandex.ru/"
          );
          return true;
        }

        session.data.url = text;
        session.data.username = username;
        session.step = "password";

        await ctx.reply(
          `✅ Email: ${username}\n\n` +
            "Шаг 2/2: Введите пароль приложения\n" +
            "⚠️ Используйте пароль приложения, не основной пароль!\n" +
            "Создать: https://id.yandex.ru/security/app-passwords"
        );
        break;

      case "password":
        session.data.password = text;

        // Delete message with password
        try {
          await ctx.deleteMessage();
        } catch (error) {
          console.error("Не удалось удалить сообщение с паролем:", error);
        }

        // Show loading message
        const loadingMsg = await ctx.reply(
          "⏳ Проверяю подключение к календарю..."
        );

        // Test connection
        const isValid = await this.testConnection(session.data);

        if (isValid) {
          // Save to database
          await this.saveIntegration(userId, session.data);

          await ctx.api.editMessageText(
            ctx.chat!.id,
            loadingMsg.message_id,
            "✅ Календарь успешно подключен!\n" +
              "Теперь я могу работать с вашими событиями.\n\n" +
              "Используйте /integrations для просмотра подключенных интеграций."
          );
        } else {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            loadingMsg.message_id,
            "❌ Не удалось подключиться к календарю.\n" +
              "Проверьте правильность данных и попробуйте еще раз.\n" +
              "Используйте /add_yandex_calendar для повторной настройки."
          );
        }

        this.setupSessions.delete(userId);
        break;
    }

    return true;
  }

  private validateCalDAVUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" &&
        parsed.hostname.includes("caldav.yandex") &&
        parsed.pathname.includes("/calendars/")
      );
    } catch {
      return false;
    }
  }

  private extractUsernameFromUrl(url: string): string | null {
    // Extract email from URL like: /calendars/username@yandex.ru/events-xxx/
    // Handle both encoded (%40) and non-encoded (@) formats
    const match = url.match(/\/calendars\/([^\/]+(?:@|%40)[^\/]+)\//);
    return match ? decodeURIComponent(match[1]!) : null;
  }

  private async testConnection(data: {
    url?: string;
    username?: string;
    password?: string;
  }): Promise<boolean> {
    if (!data.url || !data.username || !data.password) {
      return false;
    }

    try {
      // Extract server URL from calendar URL
      const serverUrl = new URL(data.url);
      const baseUrl = `${serverUrl.protocol}//${serverUrl.hostname}`;

      const client = await createDAVClient({
        serverUrl: baseUrl,
        credentials: {
          username: data.username,
          password: data.password,
        },
        authMethod: "Basic",
        defaultAccountType: "caldav",
      });

      // Try to fetch calendars
      const calendars = await client.fetchCalendars();
      return calendars && calendars.length > 0;
    } catch (error) {
      console.error("Ошибка при проверке подключения к календарю:", error);
      return false;
    }
  }

  private async saveIntegration(
    userId: number,
    data: {
      url?: string;
      username?: string;
      password?: string;
    }
  ): Promise<void> {
    if (!data.url || !data.username || !data.password) {
      throw new Error("Incomplete integration data");
    }

    await this.userRepository.addIntegration(
      userId,
      "YandexCalendar",
      {
        calendarUrl: data.url,
        username: data.username,
        password: data.password,
      },
      undefined
    );
  }

  // Check if user is in setup session
  isInSetupSession(userId: number): boolean {
    return this.setupSessions.has(userId);
  }

  // Clean up old sessions (call periodically)
  cleanupSessions(): void {
    // Sessions older than 10 minutes are removed
    // In production, you'd track creation time and clean accordingly
    // For now, this is a placeholder for manual cleanup
    this.setupSessions.clear();
  }
}
