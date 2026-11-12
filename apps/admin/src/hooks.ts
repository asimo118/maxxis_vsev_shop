import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api";

/** GET a resource on mount; `reload()` refetches. */
export function useResource<T>(path: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    api.get<T>(path).then(setData).catch((e: unknown) => setError(errorText(e)));
  }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
