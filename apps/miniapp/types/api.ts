export interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

export interface SessionPayload {
  isAuthorized: boolean;
  telegram: TelegramUser | null;
}

export interface Task {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TasksResponse {
  tasks: Task[];
}

export interface JournalEntry {
  id: number;
  title: string;
  content: string;
  entryDate: string;
  mood: string;
  energy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface JournalResponse {
  entries: JournalEntry[];
}

