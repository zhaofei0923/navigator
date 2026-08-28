import { type NextRequest, NextResponse } from "next/server";
import { homeMarketHref } from "@/lib/approved-basic60/navigation";
import { normalizeOutboundCountryParam } from "@/lib/basic60/market-scope";
import { toolHref } from "@/lib/tool-journey";
import {
  APPROVED_BASIC60_DEMO_RUNTIME_PROFILE,
  BASIC60_PRIVATE_RUNTIME_PROFILE,
  SYNTHETIC_DEMO_RUNTIME_PROFILE,
  currentRuntimeProfile,
} from "@/lib/runtime-profile";

const BASIC60_ALLOWED_EXACT = new Set(["/icon.svg", "/favicon.ico", "/api/health", "/data/world-countries-110m.geojson"]);
const APPROVED_BASIC60_ALLOWED_EXACT = new Set([
  "/icon.svg",
  "/favicon.ico",
  "/api/health",
  "/data/world-countries-110m.geojson",
]);
const APPROVED_BASIC60_ALLOWED_STATIC_PREFIXES = ["/_next/"];
const APPROVED_BASIC60_EXACT_PAGE_PATHS = new Set([
  "/partners",
  "/tools",
  "/tools/assistant",
  "/tools/solar-storage",
  "/tools/feasibility",
  "/tools/tenders",
]);

function retiredDestination(pathname: string, countryCode: string | null): string | null {
  if (pathname === "/countries" || pathname === "/compare") return homeMarketHref(countryCode);
  if (pathname === "/policies" || pathname === "/risks") return toolHref("/tools", countryCode ?? "");
  if (pathname === "/opportunities" || pathname === "/tenders") return toolHref("/tools/tenders", countryCode ?? "");
  return null;
}

function countryDetailPath(pathname: string): string | null {
  const match = pathname.match(/^\/countries\/([A-Za-z]{3})(\/market-report)?$/);
  const countryCode = match ? normalizeOutboundCountryParam(match[1]) : null;
  return countryCode ? `/countries/${countryCode}${match?.[2] ?? ""}` : null;
}

function notFound() {
  return new NextResponse("Not Found", {
    status: 404,
    headers: {
      "Cache-Control": "no-store, private",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function approvedBasic60DemoProxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname.replace(/\/$/, "") || "/";
  const countryCode = normalizeOutboundCountryParam(request.nextUrl.searchParams.get("country"));
  if (pathname === "/login") {
    return NextResponse.redirect(new URL(toolHref("/", countryCode ?? ""), request.url));
  }
  if (
    APPROVED_BASIC60_ALLOWED_EXACT.has(pathname) ||
    APPROVED_BASIC60_ALLOWED_STATIC_PREFIXES.some((prefix) =>
      pathname.startsWith(prefix),
    )
  ) {
    return NextResponse.next();
  }

  if (pathname === "/basic60" || pathname === "/basic60/login") {
    return NextResponse.redirect(new URL(toolHref("/", countryCode ?? ""), request.url));
  }
  if (pathname.startsWith("/basic60/")) {
    const legacyPath = pathname.slice("/basic60".length);
    const target = retiredDestination(legacyPath, countryCode)
      ?? countryDetailPath(legacyPath)
      ?? (APPROVED_BASIC60_EXACT_PAGE_PATHS.has(legacyPath)
        ? toolHref(legacyPath, countryCode ?? "")
        : null);
    return target ? NextResponse.redirect(new URL(target, request.url)) : notFound();
  }

  const retired = retiredDestination(pathname, countryCode);
  if (retired) return NextResponse.redirect(new URL(retired, request.url));

  let internalPath: string | null = null;
  if (pathname === "/") {
    internalPath = "/approved-basic60";
  } else if (countryDetailPath(pathname)) {
    internalPath = `/approved-basic60${countryDetailPath(pathname)}`;
  } else if (APPROVED_BASIC60_EXACT_PAGE_PATHS.has(pathname)) {
    internalPath = `/approved-basic60${pathname}`;
  }

  if (internalPath !== null) {
    const destination = request.nextUrl.clone();
    destination.pathname = internalPath;
    return NextResponse.rewrite(destination);
  }

  return notFound();
}

export function proxy(request: NextRequest) {
  const runtimeProfile = currentRuntimeProfile();
  if (runtimeProfile === APPROVED_BASIC60_DEMO_RUNTIME_PROFILE) {
    return approvedBasic60DemoProxy(request);
  }
  if (runtimeProfile === SYNTHETIC_DEMO_RUNTIME_PROFILE) {
    return NextResponse.next();
  }
  if (runtimeProfile !== BASIC60_PRIVATE_RUNTIME_PROFILE) return notFound();

  const { pathname } = request.nextUrl;
  if (pathname === "/") {
    const countryCode = normalizeOutboundCountryParam(request.nextUrl.searchParams.get("country"));
    return NextResponse.redirect(new URL(toolHref("/basic60", countryCode ?? ""), request.url));
  }
  if (
    pathname === "/basic60" ||
    pathname.startsWith("/basic60/") ||
    pathname.startsWith("/_next/") ||
    BASIC60_ALLOWED_EXACT.has(pathname)
  ) {
    return NextResponse.next();
  }

  return notFound();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
