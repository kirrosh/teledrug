"use client";

import useSWR, { type Fetcher } from "swr";

import { listJournalEntriesAction } from "@/actions/journal";
import type { JournalEntry } from "@/types/api";

interface UseJournalOptions {
  enabled: boolean;
  initialEntries: JournalEntry[];
  limit?: number;
}

const fetchJournalEntries = async (params?: { limit?: number }) => {
  const payload: { limit?: number } = {};

  if (typeof params?.limit === "number") {
    payload.limit = params.limit;
  }

  const input = Object.keys(payload).length > 0 ? payload : undefined;
  const result = await listJournalEntriesAction(input);

  if (result.serverError) {
    throw new Error(result.serverError);
  }

  return result.data?.entries ?? [];
};

type JournalKey = readonly ["journal", number | undefined];

export const useJournalData = ({ enabled, initialEntries, limit }: UseJournalOptions) => {
  const key: JournalKey | null = enabled ? ["journal", limit] : null;

  const fetcher: Fetcher<JournalEntry[], JournalKey> = async ([, limitValue]) =>
    fetchJournalEntries({ limit: limitValue });

  const swr = useSWR(key, fetcher, {
    fallbackData: initialEntries,
    revalidateOnFocus: false,
  });

  return {
    entries: swr.data ?? initialEntries,
    isLoading: swr.isLoading,
    isValidating: swr.isValidating,
    error: swr.error,
    refresh: () => swr.mutate(undefined, { revalidate: true }),
  } as const;
};
