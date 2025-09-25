"use client";

import { useMemo } from "react";

import { AuthStatusCard } from "@/components/AuthStatusCard";
import { JournalEntryCard } from "@/components/JournalEntryCard";
import { useTelegramAuth } from "@/hooks/useTelegramAuth";
import { useJournalData } from "@/hooks/useJournalData";
import type { JournalEntry, SessionPayload } from "@/types/api";

interface JournalClientProps {
  initialSession: SessionPayload;
  initialEntries: JournalEntry[];
}

export const JournalClient = ({ initialSession, initialEntries }: JournalClientProps) => {
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
    entries,
    isLoading,
    isValidating,
    error: listErrorRaw,
    refresh,
  } = useJournalData({
    enabled: isAuthorized,
    initialEntries,
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
      data-view-transition-name="journal-view"
    >
      <header className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-[0.3em] text-slate-500">TeleDrug</p>
        <h1 className="text-3xl font-semibold leading-tight text-white">Журнал</h1>
        <p className="text-sm text-slate-400">
          Ваши заметки и анализ настроения. Просматривайте записи и следите за динамикой состояний.
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
        <section className="rounded-3xl border border-slate-800/60 bg-slate-900/70 p-5 shadow-[0_40px_90px_-35px_rgba(59,130,246,0.35)] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Записи</h2>
              <p className="text-xs text-slate-400">
                {entries.length > 0 ? `Всего: ${entries.length}` : "История появится после обновления"}
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
                  key={`journal-skeleton-${index}`}
                  className="h-32 rounded-2xl border border-slate-800/60 bg-slate-800/30 animate-pulse"
                />
              ))}
            </div>
          ) : null}

          {!loading && !listError ? (
            entries.length > 0 ? (
              <div className="mt-4 grid gap-3">
                {entries.map((entry) => (
                  <JournalEntryCard key={entry.id} entry={entry} />
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-slate-800/60 bg-slate-900/40 px-4 py-6 text-sm text-slate-300">
                Пока нет ни одной записи. Создавайте заметки через бота — они появятся здесь автоматически.
              </div>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
};

