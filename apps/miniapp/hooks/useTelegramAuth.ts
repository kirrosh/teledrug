"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { makeRequest } from "@/lib/api";
import type { SessionPayload } from "@/types/api";

export type AuthStatus = "loading" | "idle" | "authenticating";

const emptySession: SessionPayload = { isAuthorized: false, telegram: null };

export const useTelegramAuth = () => {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [error, setError] = useState<string | null>(null);
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

  const retryAuth = useCallback(() => {
    authAttempted.current = false;
    void authenticate();
  }, [authenticate]);

  const logout = useCallback(async () => {
    setLogoutPending(true);
    try {
      await makeRequest<{ ok: boolean }>("/api/logout", { method: "POST" });
      setSession(emptySession);
      setError(null);
      authAttempted.current = false;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось завершить сессию");
    } finally {
      setLogoutPending(false);
    }
  }, []);

  return {
    session,
    status,
    error,
    setError,
    logoutPending,
    retryAuth,
    logout,
    isAuthorized: Boolean(session?.isAuthorized && session.telegram),
  } as const;
};

