import { afterEach, describe, expect, it } from "vitest";
import { DELETE, POST } from "@/app/api/session/route";
import { APPROVED_BASIC60_DEMO_RUNTIME_PROFILE } from "@/lib/runtime-profile";

afterEach(() => {
  delete process.env.NAVIGATOR_RUNTIME_PROFILE;
  delete process.env.DEMO_SHARED_PASSPHRASE;
  delete process.env.SESSION_SECRET;
  delete process.env.DEMO_COOKIE_SECURE;
});

describe("approved BASIC60 Demo session route", () => {
  it.each([
    ["POST", () =>
      POST(
        new Request("http://localhost/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passphrase: "unused" }),
        }),
      )],
    ["DELETE", () => DELETE()],
  ])("returns 404 for %s without setting a session cookie", async (_method, call) => {
    process.env.NAVIGATOR_RUNTIME_PROFILE = APPROVED_BASIC60_DEMO_RUNTIME_PROFILE;

    const response = await call();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("preserves the synthetic Demo session flow", async () => {
    process.env.DEMO_SHARED_PASSPHRASE = "synthetic-demo-passphrase";
    process.env.SESSION_SECRET = "synthetic-demo-session-secret";
    process.env.DEMO_COOKIE_SECURE = "false";

    const loginResponse = await POST(
      new Request("http://localhost/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: "synthetic-demo-passphrase" }),
      }),
    );

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain(
      "navigator_demo_session=",
    );

    const logoutResponse = await DELETE();
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.headers.get("set-cookie")).toContain(
      "navigator_demo_session=;",
    );
    expect(logoutResponse.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });
});
