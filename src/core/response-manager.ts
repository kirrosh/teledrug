import type { Context } from "grammy";

export interface ProgressStep {
  type: 'thinking' | 'processing' | 'tool_call' | 'result';
  message: string;
  emoji: string;
  metadata?: {
    toolName?: string;
    integration?: string;
    permissions?: {
      read: boolean;
      write: boolean;
    };
  };
}

export class ResponseManager {
  private activeResponses = new Map<number, {
    messageId: number;
    currentStep: ProgressStep;
    lastUpdateTime: number;
  }>();

  private readonly MIN_UPDATE_DELAY = 1000; // 1 секунда между обновлениями

  async startProgress(ctx: Context, initialStep: ProgressStep): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const response = await ctx.reply(
        `${initialStep.emoji} ${initialStep.message}`
      );

      this.activeResponses.set(chatId, {
        messageId: response.message_id,
        currentStep: initialStep,
        lastUpdateTime: Date.now()
      });
    } catch (error) {
      console.error('Failed to start progress:', error);
    }
  }

  async updateProgress(ctx: Context, step: ProgressStep): Promise<void> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const activeResponse = this.activeResponses.get(chatId);
    if (!activeResponse) return;

    const now = Date.now();
    const timeSinceLastUpdate = now - activeResponse.lastUpdateTime;

    // Предотвращаем слишком частые обновления
    if (timeSinceLastUpdate < this.MIN_UPDATE_DELAY) {
      setTimeout(() => this.updateProgress(ctx, step), this.MIN_UPDATE_DELAY - timeSinceLastUpdate);
      return;
    }

    try {
      const messageText = `${step.emoji} ${step.message}`;

      await ctx.api.editMessageText(
        chatId,
        activeResponse.messageId,
        messageText
      );

      activeResponse.currentStep = step;
      activeResponse.lastUpdateTime = now;
    } catch (error: any) {
      // Обрабатываем специфичные ошибки Telegram
      if (error.error_code === 400 &&
          error.description?.includes('message is not modified')) {
        // Сообщение не изменилось - это нормально
        return;
      }

      if (error.error_code === 429) {
        // Rate limit - попробуем позже
        console.warn('Rate limited, retrying in 2 seconds');
        setTimeout(() => this.updateProgress(ctx, step), 2000);
        return;
      }

      console.error('Failed to update progress:', error);
    }
  }

  async finishProgress(ctx: Context, finalResult: string): Promise<number | undefined> {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const activeResponse = this.activeResponses.get(chatId);

    if (!activeResponse) {
      // Fallback - отправляем новое сообщение
      const msg = await ctx.reply(finalResult);
      return msg.message_id;
    }

    try {
      await ctx.api.editMessageText(
        chatId,
        activeResponse.messageId,
        finalResult,
        { parse_mode: "Markdown" }
      );
      const messageId = activeResponse.messageId;
      this.activeResponses.delete(chatId);
      return messageId;
    } catch (error) {
      console.error('Failed to finish progress, sending new message:', error);
      // Fallback - отправляем новое сообщение
      const msg = await ctx.reply(finalResult);
      this.activeResponses.delete(chatId);
      return msg.message_id;
    }
  }

  // Очистка старых responses для предотвращения утечек памяти
  cleanup(): void {
    const now = Date.now();
    const MAX_AGE = 30 * 60 * 1000; // 30 минут

    for (const [chatId, response] of this.activeResponses.entries()) {
      if (now - response.lastUpdateTime > MAX_AGE) {
        this.activeResponses.delete(chatId);
      }
    }
  }
}