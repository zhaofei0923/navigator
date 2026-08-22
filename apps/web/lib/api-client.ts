import type { DemoEnvelope, DemoErrorEnvelope } from "@/lib/types";

export class DemoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "DemoApiError";
  }
}

function isEnvelope<T>(value: unknown): value is DemoEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DemoEnvelope<T>>;
  return (
    candidate.meta?.data_origin === "synthetic_demo" &&
    candidate.meta.disclaimer === "演示数据 / 非正式结论" &&
    "data" in candidate
  );
}

export async function demoApi<T>(
  path: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<DemoEnvelope<T>> {
  const response = await fetch(`/api/demo/${path.replace(/^\/+/, "")}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DemoApiError("演示数据响应格式无效。", response.status);
  }

  if (!response.ok) {
    const rawError = (payload as { error?: unknown }).error;
    const errorObject =
      typeof rawError === "object" && rawError !== null
        ? (rawError as NonNullable<DemoErrorEnvelope["error"]>)
        : undefined;
    const message =
      errorObject?.message ||
      (typeof rawError === "string" ? rawError : undefined) ||
      "演示数据加载失败。";
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.replace("/login?expired=1");
    }
    throw new DemoApiError(message, response.status, errorObject?.code);
  }

  if (!isEnvelope<T>(payload)) {
    throw new DemoApiError("响应未标识为合成演示数据，已停止显示。", 502);
  }
  return payload;
}
