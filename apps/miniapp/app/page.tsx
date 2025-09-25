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

interface TasksResponse {
  tasks: unknown[];
}

interface JournalResponse {
  entries: unknown[];
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

export default function Home() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<"loading" | "idle" | "authenticating">("loading");
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<unknown[]>([]);
  const [journalEntries, setJournalEntries] = useState<unknown[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [journalLoading, setJournalLoading] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [journalError, setJournalError] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const authAttempted = useRef(false);

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
      setTasks(Array.isArray(data.tasks) ? data.tasks : []);
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
      setJournalEntries(Array.isArray(data.entries) ? data.entries : []);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось получить журнал";
      setJournalError(message);
    } finally {
      setJournalLoading(false);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center gap-8 px-6 py-10">
      <header className="w-full max-w-3xl flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">TeleDrug MiniApp</h1>
        <p className="text-sm text-slate-300">
          Авторизация через Telegram и iron-session. После успешного входа можно выполнять запросы
          к базе данных напрямую из интерфейса.
        </p>
      </header>

      <section className="w-full max-w-3xl rounded-lg border border-slate-800 bg-slate-900/40 p-6 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">Состояние сессии</h2>
            <p className="text-xs text-slate-400">Статус: {status === "authenticating" ? "авторизация" : status === "loading" ? "проверка" : "готово"}</p>
          </div>
          {session?.isAuthorized ? (
            <button
              className="rounded bg-red-500 px-3 py-1 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
              onClick={handleLogout}
              disabled={logoutPending}
            >
              {logoutPending ? "Выходим..." : "Выйти"}
            </button>
          ) : (
            <button
              className="rounded bg-blue-500 px-3 py-1 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-50"
              onClick={handleRetryAuth}
              disabled={status !== "idle"}
            >
              Повторить
            </button>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {session?.isAuthorized && session.telegram ? (
          <dl className="mt-4 grid gap-2 text-sm text-slate-200">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">Пользователь</dt>
              <dd className="font-medium">{session.telegram.firstName} {session.telegram.lastName ?? ""}</dd>
            </div>
            {session.telegram.username && (
              <div className="flex justify-between gap-2">
                <dt className="text-slate-400">Username</dt>
                <dd className="font-medium">@{session.telegram.username}</dd>
              </div>
            )}
            <div className="flex justify-between gap-2">
              <dt className="text-slate-400">ID</dt>
              <dd className="font-mono">{session.telegram.id}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-slate-300">
            Для работы UI необходимо запустить мини-приложение внутри Telegram, чтобы передать initData.
          </p>
        )}
      </section>

      {session?.isAuthorized ? (
        <div className="w-full max-w-3xl grid gap-6 md:grid-cols-2">
          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Задачи</h3>
              <button
                className="rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
                onClick={loadTasks}
                disabled={tasksLoading}
              >
                {tasksLoading ? "Загружаем..." : "Обновить"}
              </button>
            </div>
            {tasksError ? (
              <p className="mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{tasksError}</p>
            ) : (
              <pre className="mt-3 max-h-56 overflow-auto rounded bg-slate-950/60 p-3 text-xs text-slate-100">
{JSON.stringify(tasks, null, 2)}
              </pre>
            )}
          </section>

          <section className="rounded-lg border border-slate-800 bg-slate-900/40 p-6 shadow-lg">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Журнал</h3>
              <button
                className="rounded bg-emerald-500 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-400 disabled:opacity-50"
                onClick={loadJournal}
                disabled={journalLoading}
              >
                {journalLoading ? "Загружаем..." : "Обновить"}
              </button>
            </div>
            {journalError ? (
              <p className="mt-3 rounded bg-red-500/10 px-3 py-2 text-sm text-red-300">{journalError}</p>
            ) : (
              <pre className="mt-3 max-h-56 overflow-auto rounded bg-slate-950/60 p-3 text-xs text-slate-100">
{JSON.stringify(journalEntries, null, 2)}
              </pre>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
