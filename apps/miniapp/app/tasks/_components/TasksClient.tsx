"use client";

import { useMemo } from "react";

import { AuthStatusCard } from "@/components/AuthStatusCard";
import { TaskCard } from "@/components/TaskCard";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { useTasksData } from "@/hooks/useTasksData";
import type { SessionPayload, Task } from "@/types/api";

interface TasksClientProps {
  initialSession: SessionPayload;
  initialTasks: Task[];
}

export const TasksClient = ({ initialSession, initialTasks }: TasksClientProps) => {
  const {
    session,
    status,
    error,
    logoutPending,
    retryAuth,
    logout,
    isAuthorized,
  } = useTelegramAuth({ initialSession });

  const {
    tasks,
    isLoading,
    isValidating,
    error: listErrorRaw,
    refresh,
  } = useTasksData({
    enabled: isAuthorized,
    initialTasks,
  });

  const listError = useMemo(() => {
    if (!listErrorRaw) return null;
    if (listErrorRaw instanceof Error) return listErrorRaw.message;
    return String(listErrorRaw);
  }, [listErrorRaw]);

  const loading = isLoading || isValidating;

  return (
    <div
      className="flex h-full flex-col gap-6 px-4 pb-6 sm:px-6"
      data-view-transition-name="tasks-view"
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">TeleDrug</p>
        <h1 className="text-3xl font-semibold leading-tight text-white">Задачи</h1>
        <p className="text-sm text-slate-400">
          Актуальные задачи из вашей базы. Управляйте рабочим списком прямо из Telegram.
        </p>
      </header>

      <AuthStatusCard
        session={session}
        status={status}
        error={error}
        onRetry={retryAuth}
        onLogout={logout}
        logoutPending={logoutPending}
      />

      {isAuthorized ? (
        <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-[0_40px_90px_-35px_rgba(34,197,94,0.35)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Список задач</h2>
              <p className="text-xs text-slate-400">
                {tasks.length > 0 ? `Всего: ${tasks.length}` : "Обновите список, чтобы увидеть изменения"}
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-full border border-slate-700/60 bg-slate-800/60 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-600 hover:text-white disabled:opacity-60"
              onClick={() => {
                void refresh();
              }}
              disabled={loading}
            >
              {loading ? "Обновляем..." : "Обновить"}
            </button>
          </div>

          {listError ? (
            <p className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {listError}
            </p>
          ) : null}

          {loading ? (
            <div className="mt-4 grid gap-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={`task-skeleton-${index}`}
                  className="h-24 rounded-2xl border border-slate-800/60 bg-slate-800/30 animate-pulse"
                />
              ))}
            </div>
          ) : null}

          {!loading && !listError ? (
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
      ) : null}
    </div>
  );
};

