/**
 * Send notification to Telegram bot about successful OAuth connection
 */
export async function notifyTelegramBot(
  userId: number,
  event: 'google_calendar_connected' | 'google_calendar_error',
  error?: string
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    console.error('TELEGRAM_BOT_TOKEN not configured');
    return;
  }

  let message = '';

  if (event === 'google_calendar_connected') {
    message =
      '✅ *Google Calendar успешно подключен!*\n\n' +
      'Теперь вы можете:\n' +
      '• 📅 Просматривать события календаря\n' +
      '• ➕ Создавать новые события\n' +
      '• 🔄 Синхронизировать задачи с календарем\n\n' +
      '💬 Попробуйте:\n' +
      '• "Покажи мои события на сегодня"\n' +
      '• "Создай встречу завтра в 10:00"';
  } else if (event === 'google_calendar_error') {
    message =
      '❌ *Ошибка при подключении Google Calendar*\n\n' +
      `Причина: ${error || 'Неизвестная ошибка'}\n\n` +
      'Попробуйте снова: /connect_google';
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: userId,
          text: message,
          parse_mode: 'Markdown',
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to send Telegram notification:', error);
    }
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
  }
}
