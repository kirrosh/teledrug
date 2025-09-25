"use client";

import type { SessionPayload } from "@/types/api";
import type { AuthStatus } from "@/hooks/useTelegramAuth";

interface Props {
  session: SessionPayload | null;
  status: AuthStatus;
  error: string | null;
  onRetry: () => void;
  onLogout: () => void;
  logoutPending: boolean;
}

export const AuthStatusCard = ({
  session,
  status,
  error,
  onRetry,
  onLogout,
  logoutPending,
}: Props) => (
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
          onClick={onLogout}
          disabled={logoutPending}
        >
          {logoutPending ? "Выходим..." : "Выйти"}
        </button>
      ) : (
        <button
          className="rounded-full bg-sky-500 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-sky-500/25 transition hover:bg-sky-400 disabled:opacity-60"
          onClick={onRetry}
          disabled={status !== "idle"}
        >
          {status === "authenticating" ? "Авторизация..." : "Повторить вход"}
        </button>
      )}
    </div>

    {error ? (
      <p className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
        {error}
      </p>
    ) : null}

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
        Откройте мини-приложение внутри Telegram, чтобы подтвердить авторизацию. После этого здесь появятся
        ваши данные.
      </p>
    )}
  </section>
);

