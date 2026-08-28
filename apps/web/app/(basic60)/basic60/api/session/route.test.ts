import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetBasic60LoginRateLimit } from "@/lib/basic60/login-rate-limit";
import { DELETE, POST } from "./route";

vi.mock("@/lib/basic60/session", () => ({
  BASIC60_COOKIE_NAME: "navigator_basic60_private_session",
  BASIC60_COOKIE_PATH: "/basic60",
  BASIC60_SESSION_MAX_AGE_SECONDS: 28_800,
  createBasic60SessionToken: () => "basic60-session-token",
  isBasic60SessionConfigured: () => true,
  secureBasic60CookieEnabled: () => true,
  verifyBasic60Passphrase: (value: string) => value === "correct-private-passphrase",
}));

describe("BASIC60 isolated session", () => {
  beforeEach(() => {
    resetBasic60LoginRateLimit();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sets a distinct secure cookie scoped to /basic60", async () => {
    const response = await POST(new Request("http://localhost/basic60/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "correct-private-passphrase" }),
    }));
    expect(response.status).toBe(200);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("navigator_basic60_private_session=basic60-session-token");
    expect(cookie).toContain("Path=/basic60");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
  });

  it("expires only the BASIC60 cookie", async () => {
    const response = await DELETE();
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("navigator_basic60_private_session=");
    expect(cookie).toContain("Path=/basic60");
    expect(cookie).toMatch(/Max-Age=0/i);
    expect(cookie).not.toContain("navigator_demo_session");
  });

  it("limits the sixth failed login for ten minutes without changing the cookie", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T08:00:00.000Z"));

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await POST(new Request("http://localhost/basic60/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: "wrong-private-passphrase" }),
      }));
      expect(response.status).toBe(401);
    }

    const limited = await POST(new Request("http://localhost/basic60/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: "wrong-private-passphrase" }),
    }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("600");
    expect(limited.headers.get("set-cookie")).toBeNull();
  });

  it("resets accumulated failures after a successful login", async () => {
    const request = (passphrase: string) => new Request(
      "http://localhost/basic60/api/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      },
    );

    expect((await POST(request("wrong-private-passphrase"))).status).toBe(401);
    expect((await POST(request("wrong-private-passphrase"))).status).toBe(401);
    expect((await POST(request("correct-private-passphrase"))).status).toBe(200);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await POST(request("wrong-private-passphrase"))).status).toBe(401);
    }
    expect((await POST(request("wrong-private-passphrase"))).status).toBe(429);
  });
});
