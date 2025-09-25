"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  authorizeTelegramAction,
  getSessionAction,
  logoutAction,
} from "@/actions/session";
import type { SessionPayload } from "@/types/api";

export type AuthStatus = "loading" | "idle" | "authenticating";

const emptySession: SessionPayload = { isAuthorized: false, telegram: null };

const sessionFetcher = async (): Promise<SessionPayload> => {
  const result = await getSessionAction();

  if (result.serverError) {
    throw new Error(result.serverError);
  }

  return result.data ?? emptySession;
};

interface UseTelegramAuthOptions {
  initialSession: SessionPayload;
}

export const useTelegramAuth = ({ initialSession }: UseTelegramAuthOptions) => {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const authAttempted = useRef(false);

  const {
    data: session = emptySession,
    error: sessionError,
    isLoading,
    mutate,
  } = useSWR<SessionPayload>("session", sessionFetcher, {
    fallbackData: initialSession ?? emptySession,
    revalidateOnFocus: false,
    revalidateIfStale: true,
  });

  useEffect(() => {
    if (isLoading && status !== "authenticating") {
      setStatus("loading");
      return;
    }

    if (!isLoading && status === "loading") {
      setStatus("idle");
    }
  }, [isLoading, status]);

  useEffect(() => {
    if (!sessionError) {
      return;
    }

    const message =
      sessionError instanceof Error ? sessionError.message : "Не удалось проверить сессию";
    setError(message);
  }, [sessionError]);

  const updateSession = useCallback(
    async (next: SessionPayload, revalidate = false) => {
      await mutate(next, { revalidate });
    },
    [mutate],
  );

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
      const result = await authorizeTelegramAction({ initData: telegram.initData });

      if (result.serverError) {
        throw new Error(result.serverError);
      }

      const nextSession = result.data ?? emptySession;
      await updateSession(nextSession, false);
      setError(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Авторизация не удалась";
      setError(message);
    } finally {
      setStatus("idle");
    }
  }, [updateSession]);

  useEffect(() => {
    if (status !== "idle") return;
    if (!session) return;
    if (session.isAuthorized) return;
    if (authAttempted.current) return;

    void authenticate();
  }, [authenticate, session, status]);

  const retryAuth = useCallback(() => {
    authAttempted.current = false;
    void authenticate();
  }, [authenticate]);

  const logout = useCallback(async () => {
    setLogoutPending(true);
    try {
      const result = await logoutAction();

      if (result.serverError) {
        throw new Error(result.serverError);
      }

      await updateSession(emptySession, false);
      setError(null);
      authAttempted.current = false;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Не удалось завершить сессию";
      setError(message);
    } finally {
      setLogoutPending(false);
    }
  }, [updateSession]);

  const refreshSession = useCallback(async () => {
    await mutate(undefined, { revalidate: true });
  }, [mutate]);

  const isAuthorized = useMemo(
    () => Boolean(session?.isAuthorized && session.telegram),
    [session],
  );

  return {
    session,
    status,
    error,
    setError,
    logoutPending,
    retryAuth,
    logout,
    refreshSession,
    isAuthorized,
  } as const;
};
