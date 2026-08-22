"use client";

import { useCallback, useEffect, useState } from "react";
import { demoApi } from "@/lib/api-client";
import type { DemoMeta } from "@/lib/types";

type QueryState<T> = {
  data: T | null;
  meta: DemoMeta | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

export function useDemoQuery<T>(path: string | null): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [meta, setMeta] = useState<DemoMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [attempt, setAttempt] = useState(0);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!path) return;

    const requestPath = path;
    const controller = new AbortController();
    async function load() {
      await Promise.resolve();
      if (controller.signal.aborted) return;
      setLoading(true);
      setError(null);
      try {
        const response = await demoApi<T>(requestPath, { signal: controller.signal });
        setData(response.data);
        setMeta(response.meta);
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setData(null);
        setError(reason instanceof Error ? reason.message : "演示数据加载失败。");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [path, attempt]);

  return path
    ? { data, meta, error, loading, reload }
    : { data: null, meta: null, error: null, loading: false, reload };
}
