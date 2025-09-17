export enum InteractionType {
  TEXT = 'text',           // Полный доступ (read + write)
  VOICE = 'voice',         // Полный доступ (read + write)
  IMAGE = 'image',         // Только создание (write: только createEvent)
  FORWARD = 'forward'      // Только создание (write: только createEvent)
}

export interface ToolPermissions {
  read: boolean;    // Чтение данных (getEvents, getLastEvents)
  write: boolean;   // Запись данных (createEvent, updateEvent, deleteEvent)
}

export interface ToolMetadata {
  name: string;
  permissions: ToolPermissions;
  supportedInteractionTypes: InteractionType[];
  progressMessage: string;
  progressEmoji: string;
  description: string;
}

export interface ChatContextConfig {
  interactionType: InteractionType;
  userId: string | number;
  chatId: string | number;
  messageContent: string;
  mediaContent?: any; // для изображений/аудио
  metadata?: any; // дополнительные данные
  integrations: any[]; // будет типизировано позже
}