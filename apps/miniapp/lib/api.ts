export const makeRequest = async <T,>(url: string, init?: RequestInit): Promise<T> => {
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

