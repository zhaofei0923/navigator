import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  BASIC60_SESSION_FUTURE_SKEW_SECONDS,
  BASIC60_SESSION_MAX_AGE_SECONDS,
  createBasic60SessionToken,
  verifyBasic60SessionToken,
} from "./session";

const ISSUED_AT = 1_777_000_000;

describe("BASIC60 signed session token", () => {
  beforeEach(() => {
    vi.stubEnv("BASIC60_SHARED_PASSPHRASE", "correct-private-passphrase");
    vi.stubEnv(
      "BASIC60_SESSION_SECRET",
      "basic60-session-secret-that-is-at-least-thirty-two-characters",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("contains a signed issued_at payload and is valid within eight hours", () => {
    const token = createBasic60SessionToken(ISSUED_AT);
    const [encodedPayload] = token.split(".");
    expect(JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"))).toEqual({
      issued_at: ISSUED_AT,
    });
    expect(verifyBasic60SessionToken(token, ISSUED_AT)).toBe(true);
    expect(verifyBasic60SessionToken(token, ISSUED_AT + BASIC60_SESSION_MAX_AGE_SECONDS)).toBe(true);
  });

  it("rejects payload and signature tampering", () => {
    const token = createBasic60SessionToken(ISSUED_AT);
    const [encodedPayload, signature] = token.split(".");
    const changedPayload = Buffer.from(
      JSON.stringify({ issued_at: ISSUED_AT + 1 }),
      "utf8",
    ).toString("base64url");
    const changedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;

    expect(verifyBasic60SessionToken(`${changedPayload}.${signature}`, ISSUED_AT)).toBe(false);
    expect(verifyBasic60SessionToken(`${encodedPayload}.${changedSignature}`, ISSUED_AT)).toBe(false);
  });

  it("rejects a token after its eight-hour lifetime", () => {
    const token = createBasic60SessionToken(ISSUED_AT);
    expect(
      verifyBasic60SessionToken(
        token,
        ISSUED_AT + BASIC60_SESSION_MAX_AGE_SECONDS + 1,
      ),
    ).toBe(false);
  });

  it("allows bounded clock skew but rejects a token issued too far in the future", () => {
    const withinSkew = createBasic60SessionToken(
      ISSUED_AT + BASIC60_SESSION_FUTURE_SKEW_SECONDS,
    );
    const beyondSkew = createBasic60SessionToken(
      ISSUED_AT + BASIC60_SESSION_FUTURE_SKEW_SECONDS + 1,
    );

    expect(verifyBasic60SessionToken(withinSkew, ISSUED_AT)).toBe(true);
    expect(verifyBasic60SessionToken(beyondSkew, ISSUED_AT)).toBe(false);
  });
});
