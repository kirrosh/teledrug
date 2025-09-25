"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { listTasksAction } from "@/actions/tasks";
import type { Task } from "@/types/api";

interface UseTasksOptions {
  enabled: boolean;
  initialTasks: Task[];
  limit?: number;
  status?: string;
}

const fetchTasks = async (params: { limit?: number; status?: string }) => {
  const payload: { limit?: number; status?: string } = {};

  if (typeof params.limit === "number") {
    payload.limit = params.limit;
  }

  if (params.status) {
    payload.status = params.status;
  }

  const input = Object.keys(payload).length > 0 ? payload : undefined;
  const result = await listTasksAction(input);

  if (result.serverError) {
    throw new Error(result.serverError);
  }

  return result.data?.tasks ?? [];
};

export const useTasksData = ({
  enabled,
  initialTasks,
  limit,
  status,
}: UseTasksOptions) => {
  const key = useMemo(() => {
    if (!enabled) return null;
    return ["tasks", { limit, status } as const];
  }, [enabled, limit, status]);

  const swr = useSWR<Task[]>(key, async ([, params]) => fetchTasks(params), {
    fallbackData: initialTasks,
    revalidateOnFocus: false,
  });

  return {
    tasks: swr.data ?? initialTasks,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    error: swr.error,
    refresh: () => swr.mutate(undefined, { revalidate: true }),
  } as const;
};
