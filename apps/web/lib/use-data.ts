"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "./api";

export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiFailure | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (my === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiFailure ? e : new ApiFailure(0, { code: "UNKNOWN", message: "Beklenmeyen hata." }));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}
