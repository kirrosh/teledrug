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

