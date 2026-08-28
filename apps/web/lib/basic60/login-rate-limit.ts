const BASIC60_LOGIN_FAILURE_LIMIT = 5;
const BASIC60_LOGIN_WINDOW_MS = 10 * 60 * 1_000;

type Basic60LoginRateLimitState = {
  failedAttempts: number;
  windowStartedAtMs: number | null;
};

const basic60LoginRateLimit: Basic60LoginRateLimitState = {
  failedAttempts: 0,
  windowStartedAtMs: null,
};

function refreshBasic60LoginWindow(nowMs: number): void {
  const startedAt = basic60LoginRateLimit.windowStartedAtMs;
  if (startedAt === null || nowMs - startedAt < BASIC60_LOGIN_WINDOW_MS) return;
  resetBasic60LoginRateLimit();
}

export function basic60LoginRetryAfter(nowMs: number): number | null {
  refreshBasic60LoginWindow(nowMs);
  const startedAt = basic60LoginRateLimit.windowStartedAtMs;
  if (
    startedAt === null ||
    basic60LoginRateLimit.failedAttempts < BASIC60_LOGIN_FAILURE_LIMIT
  ) {
    return null;
  }
  return Math.max(1, Math.ceil((startedAt + BASIC60_LOGIN_WINDOW_MS - nowMs) / 1_000));
}

export function recordBasic60LoginFailure(nowMs: number): void {
  refreshBasic60LoginWindow(nowMs);
  if (basic60LoginRateLimit.windowStartedAtMs === null) {
    basic60LoginRateLimit.windowStartedAtMs = nowMs;
  }
  basic60LoginRateLimit.failedAttempts += 1;
}

export function resetBasic60LoginRateLimit(): void {
  basic60LoginRateLimit.failedAttempts = 0;
  basic60LoginRateLimit.windowStartedAtMs = null;
}
