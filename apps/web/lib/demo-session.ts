import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const DEMO_COOKIE_NAME = "navigator_demo_session";
export const DEMO_SESSION_MAX_AGE_SECONDS = 60 * 60 * 8;

export function secureDemoCookieEnabled(): boolean {
  const configured = process.env.DEMO_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}

function configuredPassphrase(): string | null {
  const passphrase = process.env.DEMO_SHARED_PASSPHRASE?.trim();
  return passphrase && passphrase.length >= 8 ? passphrase : null;
}

function configuredSessionSecret(): string | null {
  const passphrase = configuredPassphrase();
  if (!passphrase) return null;
  const secret = process.env.SESSION_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

function equalUtf8(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isConfigured(): boolean {
  return configuredPassphrase() !== null && configuredSessionSecret() !== null;
}

export function verifyPassphrase(candidate: string): boolean {
  const expected = configuredPassphrase();
  return expected !== null && equalUtf8(candidate, expected);
}

export function createSessionToken(): string {
  const secret = configuredSessionSecret();
  if (!secret) throw new Error("Demo session is not configured");
  return createHmac("sha256", secret)
    .update("navigator:internal-demo-session:v1", "utf8")
    .digest("base64url");
}

export async function hasValidDemoSession(): Promise<boolean> {
  const secret = configuredSessionSecret();
  if (!secret) return false;

  const cookieStore = await cookies();
  const candidate = cookieStore.get(DEMO_COOKIE_NAME)?.value;
  if (!candidate) return false;
  return equalUtf8(candidate, createSessionToken());
}
