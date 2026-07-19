import { spawn as spawnChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const E2E_CONTAINER_NAME = "navigator-platform-e2e-postgres";
const E2E_DATABASE_NAME = "navigator_platform_db_1_test";
const E2E_DATABASE_PORT = 55433;
const API_PORT = 3100;
const WEB_PORT = 3000;
const PGVECTOR_IMAGE =
  "pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0";
const COMMAND_OUTPUT_LIMIT = 2 * 1024 * 1024;
const DEFAULT_READINESS_ATTEMPTS = 240;
const DEFAULT_READINESS_REQUEST_TIMEOUT_MS = 1_000;
const DEFAULT_TERMINATE_GRACE_MS = 10_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_GROUP_POLL_INTERVAL_MS = 50;
const READINESS_DELAY_MS = 250;
const EXPECTED_COUNTRY_CODES = new Set(["ID", "VN", "SA", "AE", "BR", "ZA"]);
const COUNTRY_MODULE_KEYS = new Set([
  "market-overview",
  "policy",
  "risk",
  "opportunities",
  "projects",
  "partners",
  "chinese-companies",
  "entry-strategy",
  "ai-advisor",
  "reports",
]);
const COVERAGE_LEVELS = new Set(["BASIC", "STANDARD", "COMPLETE"]);
const MODULE_COVERAGE_STATUSES = new Set(["BUILDING", "PARTIAL", "COMPLETE"]);
const SIGNAL_LEVELS = new Set(["HIGH", "MEDIUM", "LOW", "DATA_BUILDING"]);
const RECOMMENDED_PRIORITIES = new Set([
  "PRIORITY",
  "WATCH",
  "EXPLORE",
  "DATA_BUILDING",
]);

export async function runPlatformE2E({
  dependencies = createProductionDependencies(),
  environment = process.env,
  readinessAttempts = DEFAULT_READINESS_ATTEMPTS,
  readinessRequestTimeoutMs = DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
} = {}) {
  const externalDatabaseUrl = environment.DATABASE_URL;
  if (externalDatabaseUrl !== undefined) {
    requireSafeDatabaseUrl(externalDatabaseUrl);
  }
  if (!Number.isInteger(readinessAttempts) || readinessAttempts < 1) {
    throw new Error("PLATFORM_E2E_READINESS_ATTEMPTS_INVALID");
  }
  if (
    !Number.isInteger(readinessRequestTimeoutMs) ||
    readinessRequestTimeoutMs < 1
  ) {
    throw new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT_INVALID");
  }

  await requireFreePort(dependencies, API_PORT);
  await requireFreePort(dependencies, WEB_PORT);

  let ownedContainerId;
  let apiServer;
  let webServer;
  let primaryError;
  const baseEnvironment = loopbackEnvironment(environment);

  try {
    const databaseUrl = externalDatabaseUrl ?? await createOwnedDatabase(
      dependencies,
      baseEnvironment,
      (containerId) => {
        ownedContainerId = containerId;
      },
    );
    await prepareDatabase(dependencies, baseEnvironment, databaseUrl);
    await buildApplications(dependencies, baseEnvironment, databaseUrl);

    apiServer = startServer(
      dependencies,
      "api",
      "pnpm",
      ["--filter", "@navigator/api", "start"],
      {
        ...baseEnvironment,
        API_PORT: String(API_PORT),
        COUNTRY_READ_SOURCE: "database",
        DATABASE_URL: databaseUrl,
        NODE_ENV: "production",
      },
    );
    await waitForCountries(
      dependencies,
      apiServer,
      readinessAttempts,
      readinessRequestTimeoutMs,
    );

    webServer = startServer(
      dependencies,
      "web",
      "pnpm",
      [
        "--filter",
        "@navigator/web",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        String(WEB_PORT),
      ],
      {
        ...baseEnvironment,
        API_INTERNAL_BASE_URL: `http://127.0.0.1:${API_PORT}/api/v1`,
        NODE_ENV: "production",
      },
    );
    await waitForWeb(
      dependencies,
      webServer,
      readinessAttempts,
      readinessRequestTimeoutMs,
    );

    await runPlaywright(dependencies, baseEnvironment, apiServer, webServer);
  } catch (error) {
    primaryError = normalizeError(error);
  }

  const cleanupErrors = [];
  for (const server of [webServer, apiServer]) {
    if (server === undefined) continue;
    try {
      await server.spawned.killGroup();
      await server.spawned.completion;
    } catch {
      cleanupErrors.push(new Error(`PLATFORM_E2E_CLEANUP_FAILED:${server.label}`));
    }
  }
  if (ownedContainerId !== undefined) {
    try {
      const result = await runCommandResult(
        dependencies,
        "container-stop",
        "docker",
        ["stop", ownedContainerId],
        baseEnvironment,
      );
      if (result.code !== 0) {
        throw new Error("PLATFORM_E2E_CONTAINER_STOP_FAILED");
      }
    } catch {
      cleanupErrors.push(new Error("PLATFORM_E2E_CLEANUP_FAILED:container"));
    }
  }

  if (cleanupErrors[0] !== undefined) {
    throw cleanupErrors[0];
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
}

function requireSafeDatabaseUrl(value) {
  try {
    const parsed = new URL(value);
    const schemeDelimiter = value.indexOf("://");
    const rawPathStart = schemeDelimiter === -1
      ? -1
      : value.indexOf("/", schemeDelimiter + 3);
    const rawPath = rawPathStart === -1 ? "" : value.slice(rawPathStart);
    const rawAuthority = rawPathStart === -1
      ? ""
      : value.slice(schemeDelimiter + 3, rawPathStart);
    if (
      parsed.protocol !== "postgresql:" ||
      !hasLiteralLoopbackHost(rawAuthority) ||
      rawPath !== `/${E2E_DATABASE_NAME}` ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("PLATFORM_E2E_DATABASE_URL_REJECTED");
    }
    return value;
  } catch {
    throw new Error("PLATFORM_E2E_DATABASE_URL_REJECTED");
  }
}

function hasLiteralLoopbackHost(rawAuthority) {
  const hostAndPort = rawAuthority.slice(rawAuthority.lastIndexOf("@") + 1);
  if (hostAndPort.startsWith("[")) {
    const closingBracket = hostAndPort.indexOf("]");
    if (closingBracket === -1) return false;
    const rawHost = hostAndPort.slice(0, closingBracket + 1);
    const rawPort = hostAndPort.slice(closingBracket + 1);
    return rawHost === "[::1]" && (rawPort === "" || /^:\d+$/u.test(rawPort));
  }
  const separator = hostAndPort.lastIndexOf(":");
  const rawHost = separator === -1
    ? hostAndPort
    : hostAndPort.slice(0, separator);
  const rawPort = separator === -1 ? "" : hostAndPort.slice(separator);
  return rawHost === "127.0.0.1" && (rawPort === "" || /^:\d+$/u.test(rawPort));
}

async function requireFreePort(dependencies, port) {
  let isFree = false;
  try {
    isFree = await dependencies.probePort("127.0.0.1", port);
  } catch {
    throw new Error(`PLATFORM_E2E_PORT_CHECK_FAILED:${port}`);
  }
  if (!isFree) {
    throw new Error(`PLATFORM_E2E_PORT_IN_USE:${port}`);
  }
}

async function createOwnedDatabase(
  dependencies,
  environment,
  recordOwnedContainer,
) {
  const existing = await requireCommand(
    dependencies,
    "container-check",
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      `name=^/${E2E_CONTAINER_NAME}$`,
      "--format",
      "{{.ID}}",
    ],
    environment,
  );
  if (existing.stdout.trim() !== "") {
    throw new Error("PLATFORM_E2E_CONTAINER_ALREADY_EXISTS");
  }

  await requireFreePort(dependencies, E2E_DATABASE_PORT);
  const created = await requireCommand(
    dependencies,
    "container-create",
    "docker",
    [
      "run",
      "--detach",
      "--rm",
      "--name",
      E2E_CONTAINER_NAME,
      "--publish",
      `127.0.0.1:${E2E_DATABASE_PORT}:5432`,
      "--env",
      "POSTGRES_USER=navigator_test",
      "--env",
      "POSTGRES_PASSWORD=navigator_test_only",
      "--env",
      `POSTGRES_DB=${E2E_DATABASE_NAME}`,
      PGVECTOR_IMAGE,
    ],
    environment,
  );
  const containerId = created.stdout.trim();
  if (!/^[A-Za-z0-9_-]+$/u.test(containerId)) {
    throw new Error("PLATFORM_E2E_CONTAINER_ID_INVALID");
  }
  recordOwnedContainer(containerId);

  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await runCommandResult(
      dependencies,
      "container-ready",
      "docker",
      [
        "exec",
        containerId,
        "pg_isready",
        "--username",
        "navigator_test",
        "--dbname",
        E2E_DATABASE_NAME,
      ],
      environment,
    );
    if (result.code === 0) {
      ready = true;
      break;
    }
    await dependencies.delay(1_000);
  }
  if (!ready) {
    throw new Error("PLATFORM_E2E_DATABASE_NOT_READY");
  }

  return `postgresql://navigator_test:navigator_test_only@127.0.0.1:${E2E_DATABASE_PORT}/${E2E_DATABASE_NAME}`;
}

async function prepareDatabase(dependencies, environment, databaseUrl) {
  const databaseEnvironment = { ...environment, DATABASE_URL: databaseUrl };
  await requireCommand(
    dependencies,
    "prisma-generate",
    "pnpm",
    [
      "--filter",
      "@navigator/db",
      "exec",
      "prisma",
      "generate",
      "--schema",
      "prisma/schema.prisma",
    ],
    databaseEnvironment,
  );
  await requireCommand(
    dependencies,
    "prisma-migrate-deploy",
    "pnpm",
    [
      "--filter",
      "@navigator/db",
      "exec",
      "prisma",
      "migrate",
      "deploy",
      "--schema",
      "prisma/schema.prisma",
    ],
    databaseEnvironment,
  );
  const imported = await requireCommand(
    dependencies,
    "approved-basic-import",
    "pnpm",
    ["--filter", "@navigator/db", "import:approved-basic-publications"],
    databaseEnvironment,
  );
  try {
    const summaryLine = imported.stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("{") && line.endsWith("}"))
      .at(-1);
    const summary = JSON.parse(summaryLine ?? "");
    if (
      summary?.status !== "ok" ||
      summary?.countryCount !== 6 ||
      summary?.operationCount !== 72
    ) {
      throw new Error("PLATFORM_E2E_COUNTRY_IMPORT_INVALID");
    }
  } catch {
    throw new Error("PLATFORM_E2E_COUNTRY_IMPORT_INVALID");
  }
}

async function buildApplications(dependencies, environment, databaseUrl) {
  await requireCommand(
    dependencies,
    "api-build",
    "pnpm",
    ["--filter", "@navigator/api", "build"],
    { ...environment, DATABASE_URL: databaseUrl },
  );
  await requireCommand(
    dependencies,
    "web-build",
    "pnpm",
    ["--filter", "@navigator/web", "build"],
    {
      ...environment,
      API_INTERNAL_BASE_URL: `http://127.0.0.1:${API_PORT}/api/v1`,
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
    },
  );
}

function startServer(dependencies, label, command, args, environment) {
  const spawned = dependencies.spawn(command, args, {
    environment,
    kind: "server",
    label,
  });
  const server = { exit: undefined, label, spawned };
  void spawned.completion.then(
    (result) => {
      server.exit = result;
    },
    () => {
      server.exit = { code: null, signal: null, stdout: "" };
    },
  );
  return server;
}

async function waitForCountries(
  dependencies,
  server,
  attempts,
  requestTimeoutMs,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertServerRunning(server);
    let body;
    try {
      body = await runReadinessOperation(
        server,
        requestTimeoutMs,
        async (signal) => {
          const response = await dependencies.fetch(
            `http://127.0.0.1:${API_PORT}/api/v1/countries?locale=en`,
            { redirect: "manual", signal },
          );
          if (signal.aborted) {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT");
          }
          if (
            response.status !== 200 ||
            !isJsonContentType(response.headers.get("content-type"))
          ) {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
          }
          try {
            return await response.json();
          } catch {
            throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
          }
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PLATFORM_E2E_CHILD_EXITED:")) {
        throw error;
      }
      if (
        error instanceof Error &&
        error.message === "PLATFORM_E2E_COUNTRIES_READINESS_INVALID"
      ) {
        throw error;
      }
      if (attempt + 1 === attempts) {
        throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_TIMEOUT");
      }
      await delayWhileRunning(dependencies, server, READINESS_DELAY_MS);
      continue;
    }
    if (!isSixCountryEnvelope(body)) {
      throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
    }
    return;
  }
}

async function waitForWeb(dependencies, server, attempts, requestTimeoutMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertServerRunning(server);
    try {
      await runReadinessOperation(
        server,
        requestTimeoutMs,
        async (signal) => {
          const response = await dependencies.fetch(
            `http://127.0.0.1:${WEB_PORT}/en`,
            { redirect: "manual", signal },
          );
          cancelBody(response.body);
          if (signal.aborted) {
            throw new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT");
          }
          if (response.status !== 200) {
            throw new Error("PLATFORM_E2E_WEB_READINESS_INVALID");
          }
        },
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PLATFORM_E2E_CHILD_EXITED:")) {
        throw error;
      }
      if (
        error instanceof Error &&
        error.message === "PLATFORM_E2E_WEB_READINESS_INVALID"
      ) {
        throw error;
      }
      if (attempt + 1 === attempts) {
        throw new Error("PLATFORM_E2E_WEB_READINESS_TIMEOUT");
      }
      await delayWhileRunning(dependencies, server, READINESS_DELAY_MS);
      continue;
    }
    return;
  }
}

async function runReadinessOperation(
  server,
  timeoutMs,
  operation,
) {
  const controller = new AbortController();
  let timeout;
  const timedOut = new Promise((_, rejectTimeout) => {
    timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout(new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT"));
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    const probe = Promise.resolve().then(() => operation(controller.signal));
    return await raceServerExit(server, Promise.race([probe, timedOut]));
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function runPlaywright(dependencies, environment, apiServer, webServer) {
  await assertServerRunning(apiServer);
  await assertServerRunning(webServer);
  const playwright = dependencies.spawn(
    "pnpm",
    ["exec", "playwright", "test"],
    {
      environment: { ...environment, E2E_SERVERS_MANAGED: "1" },
      kind: "process-group",
      label: "playwright",
    },
  );
  const outcome = await Promise.race([
    playwright.completion.then((result) => ({ kind: "playwright", result })),
    apiServer.spawned.completion.then(() => ({ kind: "server", server: apiServer })),
    webServer.spawned.completion.then(() => ({ kind: "server", server: webServer })),
  ]);
  if (outcome.kind === "server") {
    await cleanOwnedProcess(playwright, "playwright");
    throw new Error(`PLATFORM_E2E_CHILD_EXITED:${outcome.server.label}`);
  }
  await cleanOwnedProcess(playwright, "playwright");
  if (outcome.result.code !== 0) {
    throw new Error("PLATFORM_E2E_PLAYWRIGHT_FAILED");
  }
  await assertServerRunning(apiServer);
  await assertServerRunning(webServer);
}

async function cleanOwnedProcess(spawned, label) {
  try {
    await spawned.killGroup();
    await spawned.completion;
  } catch {
    throw new Error(`PLATFORM_E2E_CLEANUP_FAILED:${label}`);
  }
}

async function raceServerExit(server, operation) {
  const outcome = await Promise.race([
    operation.then(
      (value) => ({ kind: "operation", value }),
      (error) => ({ error, kind: "operation-error" }),
    ),
    server.spawned.completion.then(() => ({ kind: "server-exit" })),
  ]);
  if (outcome.kind === "server-exit") {
    throw new Error(`PLATFORM_E2E_CHILD_EXITED:${server.label}`);
  }
  if (outcome.kind === "operation-error") {
    throw outcome.error;
  }
  return outcome.value;
}

async function delayWhileRunning(dependencies, server, milliseconds) {
  await raceServerExit(server, dependencies.delay(milliseconds));
}

async function assertServerRunning(server) {
  await Promise.resolve();
  if (server.exit !== undefined) {
    throw new Error(`PLATFORM_E2E_CHILD_EXITED:${server.label}`);
  }
}

async function requireCommand(
  dependencies,
  label,
  command,
  args,
  environment,
) {
  const result = await runCommandResult(
    dependencies,
    label,
    command,
    args,
    environment,
  );
  if (result.code !== 0) {
    throw new Error(`PLATFORM_E2E_COMMAND_FAILED:${label}`);
  }
  return result;
}

async function runCommandResult(
  dependencies,
  label,
  command,
  args,
  environment,
) {
  try {
    return await dependencies.spawn(command, args, {
      environment,
      kind: "command",
      label,
    }).completion;
  } catch {
    throw new Error(`PLATFORM_E2E_COMMAND_FAILED:${label}`);
  }
}

function isJsonContentType(value) {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" ||
    (mediaType?.startsWith("application/") === true && mediaType.endsWith("+json"));
}

function isSixCountryEnvelope(value) {
  if (!isRecord(value)) return false;
  if (
    value.success !== true ||
    !Array.isArray(value.data) ||
    value.data.length !== EXPECTED_COUNTRY_CODES.size ||
    !isCountriesMeta(value.meta)
  ) {
    return false;
  }
  const codes = value.data.map((country) =>
    isRecord(country) ? country.code : undefined
  );
  return new Set(codes).size === EXPECTED_COUNTRY_CODES.size &&
    codes.every((code) => EXPECTED_COUNTRY_CODES.has(code)) &&
    value.data.every(isLocalizedCountryCard);
}

function isCountriesMeta(value) {
  return isRecord(value) &&
    value.locale === "en" &&
    value.page === 1 &&
    value.pageSize === 20 &&
    value.textMode === "localized" &&
    value.total === EXPECTED_COUNTRY_CODES.size;
}

function isLocalizedCountryCard(value) {
  return isRecord(value) &&
    typeof value.code === "string" &&
    typeof value.name === "string" &&
    typeof value.region === "string" &&
    typeof value.flagEmoji === "string" &&
    typeof value.summary === "string" &&
    COVERAGE_LEVELS.has(value.coverageLevel) &&
    typeof value.updatedAt === "string" &&
    isStringArray(value._i18nFallback) &&
    isCompleteModuleCoverage(value.moduleCoverage) &&
    isLocalizedCountrySignals(value.signals);
}

function isCompleteModuleCoverage(value) {
  if (!Array.isArray(value) || value.length !== COUNTRY_MODULE_KEYS.size) {
    return false;
  }
  const moduleKeys = value.map((item) =>
    isRecord(item) ? item.moduleKey : undefined
  );
  return new Set(moduleKeys).size === COUNTRY_MODULE_KEYS.size &&
    moduleKeys.every((moduleKey) => COUNTRY_MODULE_KEYS.has(moduleKey)) &&
    value.every((item) =>
      isRecord(item) &&
      COUNTRY_MODULE_KEYS.has(item.moduleKey) &&
      MODULE_COVERAGE_STATUSES.has(item.status) &&
      Number.isInteger(item.dataCount) &&
      item.dataCount >= 0 &&
      typeof item.updatedAt === "string"
    );
}

function isLocalizedCountrySignals(value) {
  return isRecord(value) &&
    SIGNAL_LEVELS.has(value.opportunityLevel) &&
    SIGNAL_LEVELS.has(value.policyFriendliness) &&
    (value.recommendedEntryMode === null ||
      typeof value.recommendedEntryMode === "string") &&
    RECOMMENDED_PRIORITIES.has(value.recommendedPriority) &&
    SIGNAL_LEVELS.has(value.riskLevel) &&
    Number.isInteger(value.sourceCount) &&
    value.sourceCount >= 0 &&
    isStringArray(value.sources) &&
    typeof value.updatedAt === "string";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cancelBody(body) {
  if (body === null || body.locked) return;
  try {
    void body.cancel().catch(() => undefined);
  } catch {
    // Readiness cleanup must not replace the fixed failure code.
  }
}

function loopbackEnvironment(environment) {
  const next = { ...environment };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    delete next[key];
  }
  next.NO_PROXY = ["127.0.0.1", "localhost", "::1", environment.NO_PROXY]
    .filter((value) => typeof value === "string" && value !== "")
    .join(",");
  next.no_proxy = next.NO_PROXY;
  return next;
}

function normalizeError(error) {
  return error instanceof Error ? error : new Error("PLATFORM_E2E_FAILED");
}

function createProductionDependencies() {
  return {
    delay: (milliseconds) =>
      new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds)),
    fetch: globalThis.fetch,
    probePort: probePortFree,
    spawn: spawnProcess,
  };
}

export function spawnProcess(command, args, options) {
  const ownsProcessGroup =
    options.kind === "server" || options.kind === "process-group";
  const child = spawnChildProcess(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    detached: ownsProcessGroup,
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout?.on("data", (chunk) => {
    process.stdout.write(chunk);
    if (stdout.length < COMMAND_OUTPUT_LIMIT) {
      stdout += String(chunk).slice(0, COMMAND_OUTPUT_LIMIT - stdout.length);
    }
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(chunk);
  });
  const completion = new Promise((resolveCompletion, rejectCompletion) => {
    child.once("error", rejectCompletion);
    child.once("close", (code, signal) => {
      resolveCompletion({ code, signal, stdout });
    });
  });
  const groupId = ownsProcessGroup ? child.pid : undefined;
  let termination;

  return {
    completion,
    killGroup: () => {
      termination ??= terminateOwnedProcessGroup(groupId, {
        groupPollIntervalMs: options.groupPollIntervalMs,
        killGraceMs: options.killGraceMs,
        terminateGraceMs: options.terminateGraceMs,
      });
      return termination;
    },
    pid: child.pid,
  };
}

async function terminateOwnedProcessGroup(groupId, options) {
  if (groupId === undefined) {
    throw new Error("PLATFORM_E2E_PROCESS_PID_MISSING");
  }
  const terminateGraceMs = processGroupTiming(
    options.terminateGraceMs,
    DEFAULT_TERMINATE_GRACE_MS,
  );
  const killGraceMs = processGroupTiming(
    options.killGraceMs,
    DEFAULT_KILL_GRACE_MS,
  );
  const pollIntervalMs = processGroupTiming(
    options.groupPollIntervalMs,
    DEFAULT_GROUP_POLL_INTERVAL_MS,
  );

  if (!processGroupExists(groupId)) return;
  if (!signalProcessGroup(groupId, "SIGTERM")) return;
  if (
    await waitForProcessGroupExit(groupId, terminateGraceMs, pollIntervalMs)
  ) {
    return;
  }
  if (!signalProcessGroup(groupId, "SIGKILL")) return;
  if (await waitForProcessGroupExit(groupId, killGraceMs, pollIntervalMs)) {
    return;
  }
  throw new Error("PLATFORM_E2E_PROCESS_GROUP_STUCK");
}

function processGroupTiming(value, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("PLATFORM_E2E_PROCESS_GROUP_TIMING_INVALID");
  }
  return value;
}

async function waitForProcessGroupExit(groupId, timeoutMs, pollIntervalMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(groupId)) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return false;
    await cleanupDelay(Math.min(pollIntervalMs, remainingMs));
  }
  return true;
}

function cleanupDelay(milliseconds) {
  return new Promise((resolveDelay) => {
    // The referenced poll keeps cleanup alive after a detached leader has exited.
    setTimeout(resolveDelay, milliseconds);
  });
}

function processGroupExists(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

function signalProcessGroup(groupId, signal) {
  try {
    process.kill(-groupId, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function probePortFree(host, port) {
  return new Promise((resolveProbe, rejectProbe) => {
    const server = createServer();
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolveProbe(false);
      } else {
        rejectProbe(error);
      }
    });
    server.listen({ exclusive: true, host, port }, () => {
      server.close((error) => {
        if (error === undefined) resolveProbe(true);
        else rejectProbe(error);
      });
    });
  });
}

function isEntrypoint() {
  return process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  runPlatformE2E().catch((error) => {
    process.stderr.write(`${normalizeError(error).message}\n`);
    process.exitCode = 1;
  });
}
