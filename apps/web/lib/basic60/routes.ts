import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  currentRuntimeProfile,
} from "@/lib/runtime-profile";

const BASIC60_DEFAULT_PREFIX = "/basic60";

export function basic60Route(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const prefix =
    currentRuntimeProfile() === APPROVED_BASIC60_DEMO_RUNTIME_PROFILE
      ? ""
      : BASIC60_DEFAULT_PREFIX;

  if (normalizedPath === "/") return prefix || "/";
  return `${prefix}${normalizedPath}`;
}

export function basic60CountryRoute(code: string): string {
  return basic60Route(`/countries/${encodeURIComponent(code)}`);
}
