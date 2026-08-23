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
  const disclaimer = candidate.meta?.disclaimer;
  return candidate.meta?.data_origin === "synthetic_demo" &&
    (disclaimer === "演示数据 / 非正式结论" ||
      disclaimer === "Demo Data / Non-official Conclusions") &&
    (candidate.meta.locale === "zh-CN" || candidate.meta.locale === "en") &&
    "data" in candidate;
}

function runtimeCopy() {
  const english = typeof document !== "undefined" && document.documentElement.lang.startsWith("en");
  return english
    ? {
        invalid: "The synthetic demo response is invalid.",
        unavailable: "Unable to load synthetic demo data.",
        rejected: "The response was not identified as approved synthetic demo data and was blocked.",
        errors: {
          COUNTRY_NOT_FOUND: "The requested synthetic demo market was not found.",
          COUNTRIES_NOT_FOUND: "One or more selected synthetic demo markets were not found.",
          DEMO_API_NOT_CONFIGURED: "The synthetic-data service is not configured.",
          DEMO_DATABASE_UNAVAILABLE: "The internal demo database is temporarily unavailable.",
          DEMO_ENDPOINT_NOT_ALLOWED: "This demo endpoint is unavailable.",
          DEMO_FIXTURE_INCOMPLETE: "The synthetic demo fixture is incomplete.",
          DEMO_KEY_REQUIRED: "The synthetic-data service rejected the demo credential.",
          DEMO_REQUEST_TOO_LARGE: "The demo request is too large.",
          DEMO_SESSION_EXPIRED: "Your demo session has ended. Sign in again.",
          DEMO_TENDER_NOT_FOUND: "The requested synthetic tender was not found.",
          DEMO_UPSTREAM_INVALID: "The synthetic-data service returned an invalid response.",
          DEMO_UPSTREAM_NOT_SYNTHETIC: "A non-synthetic response was blocked.",
          DEMO_UPSTREAM_UNAVAILABLE: "The synthetic-data service is temporarily unavailable.",
          VALIDATION_ERROR: "Check the submitted demo fields and try again.",
        } as Record<string, string>,
      }
    : {
        invalid: "演示数据响应格式无效。",
        unavailable: "演示数据加载失败。",
        rejected: "响应未标识为合成演示数据，已停止显示。",
        errors: {
          COUNTRY_NOT_FOUND: "未找到请求的合成演示市场。",
          COUNTRIES_NOT_FOUND: "一个或多个所选合成演示市场不存在。",
          DEMO_API_NOT_CONFIGURED: "演示数据服务尚未配置。",
          DEMO_DATABASE_UNAVAILABLE: "内部演示数据库暂时不可用。",
          DEMO_ENDPOINT_NOT_ALLOWED: "此演示接口不可用。",
          DEMO_FIXTURE_INCOMPLETE: "合成演示数据不完整。",
          DEMO_KEY_REQUIRED: "演示数据服务拒绝了内部演示凭据。",
          DEMO_REQUEST_TOO_LARGE: "演示请求内容过大。",
          DEMO_SESSION_EXPIRED: "演示会话已结束，请重新登录。",
          DEMO_TENDER_NOT_FOUND: "未找到请求的合成招标。",
          DEMO_UPSTREAM_INVALID: "演示数据服务返回了无效响应。",
          DEMO_UPSTREAM_NOT_SYNTHETIC: "已阻止非合成数据响应。",
          DEMO_UPSTREAM_UNAVAILABLE: "演示数据服务暂时不可用。",
          VALIDATION_ERROR: "请检查提交的演示字段后重试。",
        } as Record<string, string>,
      };
}

export async function demoApi<T>(
  path: string,
  init?: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
): Promise<DemoEnvelope<T>> {
  const copy = runtimeCopy();
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
    throw new DemoApiError(copy.invalid, response.status);
  }

  if (!response.ok) {
    const rawError = (payload as { error?: unknown }).error;
    const errorObject =
      typeof rawError === "object" && rawError !== null
        ? (rawError as NonNullable<DemoErrorEnvelope["error"]>)
        : undefined;
    const code = errorObject?.code;
    const message = code ? copy.errors[code] ?? copy.unavailable : copy.unavailable;
    if (response.status === 401 && typeof window !== "undefined") {
      window.location.replace("/login?expired=1");
    }
    throw new DemoApiError(message, response.status, code);
  }

  if (!isEnvelope<T>(payload)) {
    throw new DemoApiError(copy.rejected, 502);
  }
  return payload;
}
