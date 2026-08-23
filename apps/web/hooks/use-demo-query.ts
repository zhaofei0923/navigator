"use client";

import { useCallback, useEffect, useState } from "react";
import { demoApi } from "@/lib/api-client";
import { useLocale } from "@/lib/i18n";
import type { DemoMeta } from "@/lib/types";

type QueryState<T> = {
  data: T | null;
  meta: DemoMeta | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

type InternalQueryState<T> = {
  requestKey: string | null;
  data: T | null;
  meta: DemoMeta | null;
  error: string | null;
};

export function useDemoQuery<T>(path: string | null): QueryState<T> {
  const { locale } = useLocale();
  const [attempt, setAttempt] = useState(0);
  const requestPath = path
    ? path.includes("locale=")
      ? path
      : `${path}${path.includes("?") ? "&" : "?"}locale=${locale}`
    : null;
  const requestKey = requestPath ? `${requestPath}::${attempt}` : null;
  const [state, setState] = useState<InternalQueryState<T>>({
    requestKey: null,
    data: null,
    meta: null,
    error: null,
  });

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!requestPath || !requestKey) return;
    const activePath = requestPath;
    const activeKey = requestKey;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await demoApi<T>(activePath, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setState({
          requestKey: activeKey,
          data: response.data,
          meta: response.meta,
          error: null,
        });
      } catch (reason: unknown) {
        if (controller.signal.aborted) return;
        setState({
          requestKey: activeKey,
          data: null,
          meta: null,
          error:
            reason instanceof Error
              ? reason.message
              : locale === "en"
                ? "Unable to load synthetic demo data."
                : "演示数据加载失败。",
        });
      }
    }

    void load();

    return () => controller.abort();
  }, [locale, requestKey, requestPath]);

  const matchesCurrentRequest = state.requestKey === requestKey;

  return path
    ? {
        data: matchesCurrentRequest ? state.data : null,
        meta: matchesCurrentRequest ? state.meta : null,
        error: matchesCurrentRequest ? state.error : null,
        loading: !matchesCurrentRequest,
        reload,
      }
    : { data: null, meta: null, error: null, loading: false, reload };
}
