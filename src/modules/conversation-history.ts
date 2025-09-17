export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export class ConversationHistory {
  private histories: Map<number, ConversationMessage[]> = new Map();
  private maxMessagesPerChat = 20;

  addUserMessage(chatId: number, message: string) {
    this.addMessage(chatId, {
      role: 'user',
      content: message,
      timestamp: Date.now()
    });
  }

  addAssistantMessage(chatId: number, message: string) {
    this.addMessage(chatId, {
      role: 'assistant', 
      content: message,
      timestamp: Date.now()
    });
  }

  private addMessage(chatId: number, message: ConversationMessage) {
    if (!this.histories.has(chatId)) {
      this.histories.set(chatId, []);
    }

    const history = this.histories.get(chatId)!;
    history.push(message);

    if (history.length > this.maxMessagesPerChat) {
      history.splice(0, history.length - this.maxMessagesPerChat);
    }
  }

  getHistory(chatId: number): string[] {
    const history = this.histories.get(chatId) || [];
    return history.map(msg => msg.content);
  }

  clearHistory(chatId: number) {
    this.histories.delete(chatId);
  }

  getHistoryLength(chatId: number): number {
    return this.histories.get(chatId)?.length || 0;
  }

  getRecentHistory(chatId: number, count: number): string[] {
    const history = this.histories.get(chatId) || [];
    const recentMessages = history.slice(-count);
    return recentMessages.map(msg => msg.content);
  }
}