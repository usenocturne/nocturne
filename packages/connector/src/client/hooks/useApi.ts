import { useState, useCallback } from "react";
import { api } from "../api";

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T = any>() {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: false,
    error: null,
  });

  const execute = useCallback(async (path: string, options?: RequestInit): Promise<T | null> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api<T>(path, options);
      setState({ data, loading: false, error: null });
      return data;
    } catch (err: any) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
      return null;
    }
  }, []);

  return { ...state, execute };
}
