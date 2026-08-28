import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const BASIC60_COOKIE_NAME = "navigator_basic60_private_session";
export const BASIC60_COOKIE_PATH = "/basic60";
export const BASIC60_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;
export const BASIC60_SESSION_FUTURE_SKEW_SECONDS = 60 * 5;

const BASIC60_SESSION_TOKEN_CONTEXT =
  "navigator:basic60-private:BASIC60-PRIVATE-R1:v2";

type Basic60SessionPayload = {
  issued_at: number;
};

export function secureBasic60CookieEnabled(): boolean {
  const configured = process.env.BASIC60_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

function configuredPassphrase(): string | null {
  const passphrase = process.env.BASIC60_SHARED_PASSPHRASE?.trim();
  return passphrase && passphrase.length >= 12 ? passphrase : null;
}

function configuredSessionSecret(): string | null {
  if (!configuredPassphrase()) return null;
  const secret = process.env.BASIC60_SESSION_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function equalUtf8(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isBasic60SessionConfigured(): boolean {
  return configuredPassphrase() !== null && configuredSessionSecret() !== null;
}

export function verifyBasic60Passphrase(candidate: string): boolean {
  const expected = configuredPassphrase();
  return expected !== null && equalUtf8(candidate, expected);
}

function signBasic60SessionPayload(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${BASIC60_SESSION_TOKEN_CONTEXT}.${encodedPayload}`, "utf8")
    .digest("base64url");
}

function decodeBasic60SessionPayload(encodedPayload: string): Basic60SessionPayload | null {
  if (!/^[A-Za-z0-9_-]+$/.test(encodedPayload)) return null;

  try {
    const bytes = Buffer.from(encodedPayload, "base64url");
    if (bytes.length === 0 || bytes.length > 128) return null;
    if (bytes.toString("base64url") !== encodedPayload) return null;

    const payload = JSON.parse(bytes.toString("utf8")) as unknown;
    if (
      typeof payload !== "object" ||
      payload === null ||
      Array.isArray(payload) ||
      Object.keys(payload).length !== 1 ||
      !("issued_at" in payload) ||
      !Number.isSafeInteger(payload.issued_at) ||
      Number(payload.issued_at) < 0
    ) {
      return null;
    }
    return { issued_at: Number(payload.issued_at) };
  } catch {
    return null;
  }
}

export function createBasic60SessionToken(
  issuedAtSeconds = Math.floor(Date.now() / 1_000),
): string {
  const secret = configuredSessionSecret();
  if (!secret) throw new Error("Basic60 private-trial session is not configured");
  if (!Number.isSafeInteger(issuedAtSeconds) || issuedAtSeconds < 0) {
    throw new Error("Basic60 private-trial session issue time is invalid");
  }

  const encodedPayload = Buffer.from(
    JSON.stringify({ issued_at: issuedAtSeconds } satisfies Basic60SessionPayload),
    "utf8",
  ).toString("base64url");
  return `${encodedPayload}.${signBasic60SessionPayload(encodedPayload, secret)}`;
}

export function verifyBasic60SessionToken(
  candidate: string,
  nowSeconds = Math.floor(Date.now() / 1_000),
): boolean {
  const secret = configuredSessionSecret();
  if (!secret || !Number.isSafeInteger(nowSeconds) || nowSeconds < 0) return false;
  if (candidate.length === 0 || candidate.length > 512) return false;

  const parts = candidate.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return false;
  const [encodedPayload, candidateSignature] = parts;
  const expectedSignature = signBasic60SessionPayload(encodedPayload, secret);
  if (!equalUtf8(candidateSignature, expectedSignature)) return false;

  const payload = decodeBasic60SessionPayload(encodedPayload);
  if (!payload) return false;
  if (payload.issued_at - nowSeconds > BASIC60_SESSION_FUTURE_SKEW_SECONDS) return false;
  return nowSeconds - payload.issued_at <= BASIC60_SESSION_MAX_AGE_SECONDS;
}

export async function hasValidBasic60Session(): Promise<boolean> {
  if (!configuredSessionSecret()) return false;
  const cookieStore = await cookies();
  const candidate = cookieStore.get(BASIC60_COOKIE_NAME)?.value;
  return candidate ? verifyBasic60SessionToken(candidate) : false;
}
