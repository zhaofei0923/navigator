import { describe, expect, test } from "vitest";

import { getLocaleCookieAssignment } from "./locale-cookie.js";
import { LOCALE_COOKIE_NAME } from "./routing.js";

describe("locale cookie persistence", () => {
  test("builds a persistent cookie assignment for a selected locale", () => {
    expect(getLocaleCookieAssignment("en")).toBe(
      `${LOCALE_COOKIE_NAME}=en; path=/; max-age=31536000; samesite=lax`,
    );
  });
});
