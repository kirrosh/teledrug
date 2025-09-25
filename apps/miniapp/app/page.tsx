"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface TelegramUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  languageCode?: string;
}

interface SessionPayload {
  isAuthorized: boolean;
  telegram: TelegramUser | null;
}

interface Task {
  id: number;
  title: string;
  status: string;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TasksResponse {
  tasks: Task[];
}

interface JournalEntry {
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

interface JournalResponse {
  entries: JournalEntry[];
}

const makeRequest = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    credentials: "include",
    ...init,
  });

  let data: unknown = null;

  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    if (data && typeof data === "object" && "error" in data) {
      const { error } = data as { error?: unknown };
      throw new Error(error ? String(error) : "Request failed");
    }
    throw new Error("Request failed");
  }

  return (data ?? {}) as T;
};

const emptySession: SessionPayload = { isAuthorized: false, telegram: null };

const TASK_STATUS_META: Record<
  string,
  { label: string; badgeClass: string; indicatorClass: string }
> = {
  todo: {
    label: "В работе",
    badgeClass:
      "bg-sky-500/15 text-sky-200 border border-sky-400/20 shadow-[0_0_18px_-6px_rgba(56,189,248,0.75)]",
    indicatorClass: "bg-sky-400",
  },
  done: {
    label: "Готово",
    badgeClass:
      "bg-emerald-500/15 text-emerald-200 border border-emerald-400/20 shadow-[0_0_18px_-6px_rgba(16,185,129,0.75)]",
    indicatorClass: "bg-emerald-400",
  },
  blocked: {
    label: "Заблокирована",
    badgeClass:
      "bg-rose-500/15 text-rose-200 border border-rose-400/20 shadow-[0_0_18px_-6px_rgba(244,63,94,0.75)]",
    indicatorClass: "bg-rose-400",
  },
  review: {
    label: "На проверке",
    badgeClass:
      "bg-amber-500/15 text-amber-200 border border-amber-400/20 shadow-[0_0_18px_-6px_rgba(245,158,11,0.75)]",
    indicatorClass: "bg-amber-400",
  },
};

const MOOD_LABELS: Record<string, { label: string; className: string }> = {
  very_positive: {
    label: "Отличное настроение",
    className: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30",
  },
  positive: {
    label: "Хорошее настроение",
    className: "bg-sky-500/15 text-sky-200 border border-sky-400/30",
  },
  neutral: {
    label: "Нейтрально",
    className: "bg-slate-500/15 text-slate-200 border border-slate-400/30",
  },
  negative: {
    label: "Негативное настроение",
    className: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
  },
  very_negative: {
    label: "Очень тяжело",
    className: "bg-rose-500/15 text-rose-200 border border-rose-400/30",
  },
  mixed: {
    label: "Смешанные чувства",
    className: "bg-purple-500/15 text-purple-200 border border-purple-400/30",
  },
};

const ENERGY_LABELS: Record<string, { label: string; className: string }> = {
  very_high: {
    label: "Очень высокая энергия",
    className: "bg-emerald-500/10 text-emerald-200 border border-emerald-400/20",
  },
  high: {
    label: "Высокая энергия",
    className: "bg-sky-500/10 text-sky-200 border border-sky-400/20",
  },
  medium: {
    label: "Средняя энергия",
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  },
  low: {
    label: "Низкая энергия",
    className: "bg-amber-500/10 text-amber-200 border border-amber-400/20",
  },
  very_low: {
    label: "Очень низкая энергия",
    className: "bg-rose-500/10 text-rose-200 border border-rose-400/20",
  },
};

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
});

const timeFormatter = new Intl.DateTimeFormat("ru-RU", {
  hour: "2-digit",
  minute: "2-digit",
});

const formatTaskDueDate = (iso: string | null): string => {
  if (!iso) return "Без срока";
  try {
    const date = new Date(iso);
    return dateFormatter.format(date);
  } catch {
    return "Без срока";
  }
};

const formatEntryDate = (iso: string): string => {
  try {
    const date = new Date(iso);
    return `${dayFormatter.format(date)} · ${timeFormatter.format(date)}`;
  } catch {
    return iso;
  }
};

const TaskCard = ({ task }: { task: Task }) => {
  const meta = TASK_STATUS_META[task.status] ?? {
    label: task.status,
    badgeClass:
      "bg-slate-500/15 text-slate-200 border border-slate-400/20 shadow-[0_0_18px_-6px_rgba(148,163,184,0.75)]",
    indicatorClass: "bg-slate-400",
  };

  const dueLabel = formatTaskDueDate(task.dueAt);
  const updatedLabel = formatTaskDueDate(task.updatedAt);

  return (
    <article className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 shadow-[0_10px_40px_-24px_rgba(15,118,110,0.6)] backdrop-blur">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold leading-snug text-slate-50">
          {task.title}
        </h3>
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${meta.badgeClass}`}>
          {meta.label}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className={`inline-flex h-2 w-2 rounded-full ${meta.indicatorClass}`} />
          {dueLabel}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2 w-2 rounded-full bg-slate-500" />
          Обновлено: {updatedLabel}
        </span>
      </div>
    </article>
  );
};

const JournalEntryCard = ({ entry }: { entry: JournalEntry }) => {
  const mood = MOOD_LABELS[entry.mood] ?? {
    label: entry.mood,
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  };
  const energy = ENERGY_LABELS[entry.energy] ?? {
    label: entry.energy,
    className: "bg-slate-500/10 text-slate-200 border border-slate-400/20",
  };

  const entryDateLabel = formatEntryDate(entry.entryDate || entry.createdAt);

  return (
    <article className="rounded-2xl border border-slate-800/60 bg-slate-900/60 p-4 shadow-[0_10px_40px_-24px_rgba(59,130,246,0.6)] backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-base font-semibold leading-snug text-slate-50">
            {entry.title}
          </h3>
          <span className="text-xs text-slate-400">{entryDateLabel}</span>
        </div>
        <div className="flex flex-col items-end gap-2 text-xs">
          <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${mood.className}`}>
            {mood.label}
          </span>
          <span className={`inline-flex items-center rounded-full px-3 py-1 font-medium ${energy.className}`}>
            {energy.label}
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-200 whitespace-pre-line">
        {entry.content}
      </p>
      {entry.tags && entry.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {entry.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center rounded-full border border-slate-700/60 bg-slate-800/60 px-3 py-1 text-xs font-medium text-slate-200"
            >
              #{tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
};

export default function Home() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "authenticating">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [journalLoading, setJournalLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const authAttempted = useRef(false);
  const dataPrefetched = useRef(false);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        const data = await makeRequest<SessionPayload>("/api/session");
        if (!active) return;
        setSession(data);
        setStatus("idle");
        setError(null);
      } catch (cause) {
        if (!active) return;
        setSession(emptySession);
        setStatus("idle");
        setError(cause instanceof Error ? cause.message : "Не удалось проверить сессию");
      }
    };

    void initialize();

    return () => {
      active = false;
    };
  }, []);

  const authenticate = useCallback(async () => {
    const telegram = window.Telegram?.WebApp;

    if (!telegram || !telegram.initData) {
      authAttempted.current = true;
      setError("Откройте мини-приложение внутри Telegram, чтобы авторизоваться.");
      return;
    }

    telegram.ready?.();
    telegram.expand?.();

    setStatus("authenticating");
    authAttempted.current = true;

    try {
      const data = await makeRequest<SessionPayload>("/api/auth/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: telegram.initData }),
      });
      setSession(data);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Авторизация не удалась");
    } finally {
      setStatus("idle");
    }
  }, []);

  useEffect(() => {
    if (status !== "idle") return;
    if (!session) return;
    if (session.isAuthorized) return;
    if (authAttempted.current) return;

    void authenticate();
  }, [authenticate, session, status]);

  const handleRetryAuth = useCallback(() => {
    authAttempted.current = false;
    void authenticate();
  }, [authenticate]);

  const handleLogout = useCallback(async () => {
    setLogoutPending(true);
    try {
      await makeRequest<{ ok: boolean }>("/api/logout", { method: "POST" });
      setSession(emptySession);
      setTasks([]);
      setJournalEntries([]);
      setTasksError(null);
      setJournalError(null);
      authAttempted.current = false;
      dataPrefetched.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось завершить сессию");
    } finally {
      setLogoutPending(false);
    }
  }, []);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    setTasksError(null);
    try {
      const data = await makeRequest<TasksResponse>("/api/tasks");
      const parsed = Array.isArray(data.tasks) ? data.tasks : [];
      setTasks(parsed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось получить задачи";
      setTasksError(message);
    } finally {
      setTasksLoading(false);
    }
  }, []);

  const loadJournal = useCallback(async () => {
    setJournalLoading(true);
    setJournalError(null);
    try {
      const data = await makeRequest<JournalResponse>("/api/journal");
      const parsed = Array.isArray(data.entries) ? data.entries : [];
      setJournalEntries(parsed);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось получить журнал";
      setJournalError(message);
    } finally {
      setJournalLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!session?.isAuthorized) return;
    if (dataPrefetched.current) return;

    dataPrefetched.current = true;
    void Promise.all([loadTasks(), loadJournal()]);
  }, [loadJournal, loadTasks, session?.isAuthorized]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-10 sm:px-6">
        <header className="flex flex-col gap-2">
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">TeleDrug</p>
          <h1 className="text-3xl font-semibold leading-tight text-white">
            Управление задачами и записями прямо в Telegram
          </h1>
          <p className="text-sm text-slate-400">
            Всё синхронизируется с вашей базой данных. Авторизуйтесь через мини-приложение и управляйте
            задачами и заметками без переключения между приложениями.
          </p>
        </header>

        <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-[0_40px_90px_-35px_rgba(56,189,248,0.35)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Статус авторизации</h2>
              <p className="text-xs text-slate-400">
                {status === "authenticating"
                  ? "Авторизация через Telegram..."
                  : status === "loading"
                  ? "Проверяем сессию..."
                  : session?.isAuthorized
                  ? "Вы успешно авторизованы"
                  : "Требуется авторизация"}
              </p>
            </div>
            {session?.isAuthorized ? (
              <button
                className="rounded-full bg-rose-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-500/25 transition hover:bg-rose-400 disabled:opacity-60"
                onClick={handleLogout}
                disabled={logoutPending}
              >
                {logoutPending ? "Выходим..." : "Выйти"}
              </button>
            ) : (
              <button
                className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400 disabled:opacity-60"
                onClick={handleRetryAuth}
                disabled={status !== "idle"}
              >
                {status === "authenticating" ? "Авторизация..." : "Повторить вход"}
              </button>
            )}
          </div>

          {error && (
            <p className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </p>
          )}

          {session?.isAuthorized && session.telegram ? (
            <dl className="mt-4 grid gap-3 text-sm text-slate-200">
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">Пользователь</dt>
                <dd className="font-medium">
                  {session.telegram.firstName} {session.telegram.lastName ?? ""}
                </dd>
              </div>
              {session.telegram.username ? (
                <div className="flex items-center justify-between">
                  <dt className="text-slate-400">Telegram</dt>
                  <dd className="font-medium">@{session.telegram.username}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <dt className="text-slate-400">ID</dt>
                <dd className="font-mono text-xs">{session.telegram.id}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm text-slate-300">
              Откройте мини-приложение внутри Telegram, чтобы передать данные авторизации. После этого здесь
              появятся ваши задачи и записи.
            </p>
          )}
        </section>

        {session?.isAuthorized ? (
          <>
            <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-[0_40px_90px_-35px_rgba(34,197,94,0.35)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Задачи</h2>
                  <p className="text-xs text-slate-400">
                    {tasks.length > 0
                      ? `Всего задач: ${tasks.length}`
                      : "Список задач загрузится сразу после авторизации"}
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white disabled:opacity-60"
                  onClick={loadTasks}
                  disabled={tasksLoading}
                >
                  {tasksLoading ? "Обновляем..." : "Обновить"}
                </button>
              </div>

              {tasksError ? (
                <p className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {tasksError}
                </p>
              ) : null}

              {tasksLoading ? (
                <div className="mt-4 grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={`task-skeleton-${index}`}
                      className="h-24 rounded-2xl border border-slate-800/60 bg-slate-800/30 animate-pulse"
                    />
                  ))}
                </div>
              ) : null}

              {!tasksLoading && !tasksError ? (
                tasks.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {tasks.map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    Задач пока нет. Создайте их через бота или другое приложение, и они появятся здесь.
                  </div>
                )
              ) : null}
            </section>

            <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-[0_40px_90px_-35px_rgba(59,130,246,0.35)] backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Записи журнала</h2>
                  <p className="text-xs text-slate-400">
                    {journalEntries.length > 0
                      ? `Записей: ${journalEntries.length}`
                      : "Журнал загрузится автоматически"}
                  </p>
                </div>
                <button
                  className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white disabled:opacity-60"
                  onClick={loadJournal}
                  disabled={journalLoading}
                >
                  {journalLoading ? "Обновляем..." : "Обновить"}
                </button>
              </div>

              {journalError ? (
                <p className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {journalError}
                </p>
              ) : null}

              {journalLoading ? (
                <div className="mt-4 grid gap-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={`journal-skeleton-${index}`}
                      className="h-32 rounded-2xl border border-slate-800/60 bg-slate-800/30 animate-pulse"
                    />
                  ))}
                </div>
              ) : null}

              {!journalLoading && !journalError ? (
                journalEntries.length > 0 ? (
                  <div className="mt-4 grid gap-3">
                    {journalEntries.map((entry) => (
                      <JournalEntryCard key={entry.id} entry={entry} />
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                    Здесь появятся ваши заметки. Создайте запись через бота, чтобы увидеть результат анализа.
                  </div>
                )
              ) : null}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
