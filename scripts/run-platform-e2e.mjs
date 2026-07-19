import { spawn as spawnChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
export const PLATFORM_E2E_DEFAULT_READINESS_REQUEST_TIMEOUT_MS = 3_000;
const DEFAULT_TERMINATE_GRACE_MS = 10_000;
const DEFAULT_KILL_GRACE_MS = 5_000;
const DEFAULT_GROUP_POLL_INTERVAL_MS = 50;
const DEFAULT_CONTAINER_CREATE_TIMEOUT_MS = 120_000;
const DEFAULT_CONTAINER_STOP_TIMEOUT_MS = 30_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const READINESS_DELAY_MS = 250;
const INTERRUPT_EXIT_CODES = Object.freeze({ SIGINT: 130, SIGTERM: 143 });
const INTERRUPT_SIGNALS = Object.freeze(Object.keys(INTERRUPT_EXIT_CODES));

export async function runPlatformE2E({
  containerCreateTimeoutMs = DEFAULT_CONTAINER_CREATE_TIMEOUT_MS,
  containerStopTimeoutMs = DEFAULT_CONTAINER_STOP_TIMEOUT_MS,
  dependencies = createProductionDependencies(),
  environment = process.env,
  interruptSignal,
  readinessAttempts = DEFAULT_READINESS_ATTEMPTS,
  readinessRequestTimeoutMs = PLATFORM_E2E_DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
} = {}) {
  throwIfInterrupted(interruptSignal);
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
  requirePositiveInteger(
    containerCreateTimeoutMs,
    "PLATFORM_E2E_CONTAINER_CREATE_TIMEOUT_INVALID",
  );
  requirePositiveInteger(
    containerStopTimeoutMs,
    "PLATFORM_E2E_CONTAINER_STOP_TIMEOUT_INVALID",
  );

  await requireFreePort(dependencies, API_PORT, interruptSignal);
  await requireFreePort(dependencies, WEB_PORT, interruptSignal);

  let ownedContainerId;
  let apiServer;
  let playwright;
  let webServer;
  let primaryError;
  let cleanupPromise;
  const baseEnvironment = loopbackEnvironment(environment);
  const cleanupOwnedResourcesOnce = () => {
    cleanupPromise ??= cleanOwnedResources(
      dependencies,
      { apiServer, ownedContainerId, playwright, webServer },
      baseEnvironment,
      containerStopTimeoutMs,
    );
    return cleanupPromise;
  };

  try {
    const databaseUrl = externalDatabaseUrl ?? await createOwnedDatabase(
      dependencies,
      baseEnvironment,
      (containerId) => {
        ownedContainerId = containerId;
      },
      interruptSignal,
      containerCreateTimeoutMs,
    );
    await prepareDatabase(
      dependencies,
      baseEnvironment,
      databaseUrl,
      interruptSignal,
    );
    await buildApplications(
      dependencies,
      baseEnvironment,
      databaseUrl,
      interruptSignal,
    );

    throwIfInterrupted(interruptSignal);
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
    await waitForApiReady(
      dependencies,
      apiServer,
      readinessAttempts,
      readinessRequestTimeoutMs,
      interruptSignal,
    );

    throwIfInterrupted(interruptSignal);
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
      interruptSignal,
    );

    await runPlaywright(
      dependencies,
      baseEnvironment,
      apiServer,
      webServer,
      (spawned) => {
        playwright = spawned;
      },
      interruptSignal,
    );
  } catch (error) {
    primaryError = normalizeError(error);
  }

  const cleanupError = await cleanupOwnedResourcesOnce();
  const firstCleanupError = isCleanupError(primaryError)
    ? primaryError
    : cleanupError;
  if (firstCleanupError !== undefined) {
    throw firstCleanupError;
  }
  if (primaryError !== undefined) {
    throw primaryError;
  }
}

async function cleanOwnedResources(
  dependencies,
  { apiServer, ownedContainerId, playwright, webServer },
  environment,
  containerStopTimeoutMs,
) {
  const cleanupErrors = [];
  for (const [label, spawned] of [
    ["playwright", playwright],
    ["web", webServer?.spawned],
    ["api", apiServer?.spawned],
  ]) {
    if (spawned === undefined) continue;
    try {
      await cleanOwnedProcess(spawned, label);
    } catch (error) {
      cleanupErrors.push(normalizeError(error));
    }
  }
  if (ownedContainerId !== undefined) {
    try {
      const result = await withCommandWatchdog(
        dependencies,
        containerStopTimeoutMs,
        new Error("PLATFORM_E2E_CONTAINER_STOP_TIMEOUT"),
        undefined,
        (cleanupSignal) => runCommandResult(
          dependencies,
          "container-stop",
          "docker",
          ["stop", ownedContainerId],
          environment,
          cleanupSignal,
        ),
      );
      if (result.code !== 0) {
        throw new Error("PLATFORM_E2E_CONTAINER_STOP_FAILED");
      }
    } catch {
      cleanupErrors.push(new Error("PLATFORM_E2E_CLEANUP_FAILED:container"));
    }
  }
  return cleanupErrors[0];
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

function requirePositiveInteger(value, errorMessage) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_TIMER_DELAY_MS) {
    throw new Error(errorMessage);
  }
}

async function requireFreePort(dependencies, port, interruptSignal) {
  let isFree = false;
  try {
    isFree = await raceInterruption(
      dependencies.probePort("127.0.0.1", port, interruptSignal),
      interruptSignal,
    );
  } catch (error) {
    if (isInterruptionError(error)) throw error;
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
  interruptSignal,
  createTimeoutMs,
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
    interruptSignal,
  );
  if (existing.stdout.trim() !== "") {
    throw new Error("PLATFORM_E2E_CONTAINER_ALREADY_EXISTS");
  }

  await requireFreePort(dependencies, E2E_DATABASE_PORT, interruptSignal);
  throwIfInterrupted(interruptSignal);
  const receiptDirectory = await mkdtemp(
    join(tmpdir(), "navigator-platform-e2e-container-"),
  );
  const receiptPath = join(receiptDirectory, "container.cid");
  let containerId;
  const recordReceipt = async (result) => {
    const receiptId = await readOwnedContainerReceipt(receiptPath);
    if (receiptId !== undefined && containerId === undefined) {
      containerId = receiptId;
      recordOwnedContainer(receiptId);
    }
    if (result === undefined || result.code !== 0) return;
    const returnedContainerId = parseContainerId(result.stdout);
    if (receiptId === undefined || returnedContainerId === undefined) {
      throw new Error("PLATFORM_E2E_CONTAINER_ID_INVALID");
    }
    if (returnedContainerId !== receiptId) {
      throw new Error("PLATFORM_E2E_CONTAINER_ID_MISMATCH");
    }
  };
  let createError;
  try {
    try {
      await withCommandWatchdog(
        dependencies,
        createTimeoutMs,
        new Error("PLATFORM_E2E_CONTAINER_CREATE_TIMEOUT"),
        interruptSignal,
        (commandSignal) => requireCommand(
          dependencies,
          "container-create",
          "docker",
          [
            "run",
            "--cidfile",
            receiptPath,
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
          commandSignal,
          recordReceipt,
        ),
      );
    } catch (error) {
      await recordReceipt();
      createError = normalizeError(error);
    }
    if (createError === undefined && containerId === undefined) {
      createError = new Error("PLATFORM_E2E_CONTAINER_ID_INVALID");
    }
  } finally {
    try {
      const removeDirectory = dependencies.removeDirectory ?? rm;
      await removeDirectory(receiptDirectory, { force: true, recursive: true });
    } catch {
      if (!isCleanupError(createError)) {
        createError = new Error(
          "PLATFORM_E2E_CLEANUP_FAILED:container-receipt",
        );
      }
    }
  }
  if (createError !== undefined) throw createError;

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
      interruptSignal,
    );
    if (result.code === 0) {
      ready = true;
      break;
    }
    await raceInterruption(
      dependencies.delay(1_000, interruptSignal),
      interruptSignal,
    );
  }
  if (!ready) {
    throw new Error("PLATFORM_E2E_DATABASE_NOT_READY");
  }

  return `postgresql://navigator_test:navigator_test_only@127.0.0.1:${E2E_DATABASE_PORT}/${E2E_DATABASE_NAME}`;
}

async function readOwnedContainerReceipt(receiptPath) {
  try {
    return parseContainerId(await readFile(receiptPath, "utf8"));
  } catch {
    return undefined;
  }
}

function parseContainerId(value) {
  const body = value.endsWith("\r\n")
    ? value.slice(0, -2)
    : value.endsWith("\n")
    ? value.slice(0, -1)
    : value;
  return /^[A-Za-z0-9_-]+$/u.test(body) ? body : undefined;
}

async function prepareDatabase(
  dependencies,
  environment,
  databaseUrl,
  interruptSignal,
) {
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
    interruptSignal,
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
    interruptSignal,
  );
  const imported = await requireCommand(
    dependencies,
    "approved-basic-import",
    "pnpm",
    ["--filter", "@navigator/db", "import:approved-basic-publications"],
    databaseEnvironment,
    interruptSignal,
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

async function buildApplications(
  dependencies,
  environment,
  databaseUrl,
  interruptSignal,
) {
  await requireCommand(
    dependencies,
    "api-build",
    "pnpm",
    ["--filter", "@navigator/api", "build"],
    { ...environment, DATABASE_URL: databaseUrl },
    interruptSignal,
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
    interruptSignal,
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

async function waitForApiReady(
  dependencies,
  server,
  attempts,
  requestTimeoutMs,
  interruptSignal,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertServerRunning(server);
    let state;
    try {
      state = await runReadinessOperation(
        server,
        requestTimeoutMs,
        async (signal) => {
          const response = await dependencies.fetch(
            `http://127.0.0.1:${API_PORT}/health/ready`,
            { redirect: "manual", signal },
          );
          if (signal.aborted) {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT");
          }
          if (response.status !== 200 && response.status !== 503) {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_API_READINESS_INVALID");
          }
          if (!isJsonContentType(response.headers.get("content-type"))) {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_API_READINESS_INVALID");
          }
          let body;
          try {
            body = await response.json();
          } catch {
            cancelBody(response.body);
            throw new Error("PLATFORM_E2E_API_READINESS_INVALID");
          }
          if (signal.aborted) {
            throw new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT");
          }
          if (response.status === 200 && isExactReadinessBody(body, "ready")) {
            return "ready";
          }
          if (
            response.status === 503 &&
            isExactReadinessBody(body, "not_ready")
          ) {
            return "not_ready";
          }
          throw new Error("PLATFORM_E2E_API_READINESS_INVALID");
        },
        interruptSignal,
      );
    } catch (error) {
      if (isInterruptionError(error)) throw error;
      if (error instanceof Error && error.message.startsWith("PLATFORM_E2E_CHILD_EXITED:")) {
        throw error;
      }
      if (
        error instanceof Error &&
        error.message === "PLATFORM_E2E_API_READINESS_INVALID"
      ) {
        throw error;
      }
      if (attempt + 1 === attempts) {
        throw new Error("PLATFORM_E2E_API_READINESS_TIMEOUT");
      }
      await delayWhileRunning(
        dependencies,
        server,
        READINESS_DELAY_MS,
        interruptSignal,
      );
      continue;
    }
    if (state === "ready") {
      return;
    }
    if (attempt + 1 === attempts) {
      throw new Error("PLATFORM_E2E_API_READINESS_TIMEOUT");
    }
    await delayWhileRunning(
      dependencies,
      server,
      READINESS_DELAY_MS,
      interruptSignal,
    );
  }
}

async function waitForWeb(
  dependencies,
  server,
  attempts,
  requestTimeoutMs,
  interruptSignal,
) {
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
        interruptSignal,
      );
    } catch (error) {
      if (isInterruptionError(error)) throw error;
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
      await delayWhileRunning(
        dependencies,
        server,
        READINESS_DELAY_MS,
        interruptSignal,
      );
      continue;
    }
    return;
  }
}

async function runReadinessOperation(
  server,
  timeoutMs,
  operation,
  interruptSignal,
) {
  const controller = new AbortController();
  let timeout;
  const abortForInterruption = () => {
    controller.abort(getInterruptionError(interruptSignal));
  };
  if (interruptSignal?.aborted) {
    abortForInterruption();
  } else {
    interruptSignal?.addEventListener("abort", abortForInterruption, {
      once: true,
    });
  }
  const timedOut = new Promise((_, rejectTimeout) => {
    timeout = setTimeout(() => {
      controller.abort();
      rejectTimeout(new Error("PLATFORM_E2E_READINESS_REQUEST_TIMEOUT"));
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    const probe = Promise.resolve().then(() => operation(controller.signal));
    return await raceServerExit(
      server,
      raceInterruption(Promise.race([probe, timedOut]), interruptSignal),
    );
  } finally {
    clearTimeout(timeout);
    controller.abort();
    interruptSignal?.removeEventListener("abort", abortForInterruption);
  }
}

async function runPlaywright(
  dependencies,
  environment,
  apiServer,
  webServer,
  recordOwnedPlaywright,
  interruptSignal,
) {
  throwIfInterrupted(interruptSignal);
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
  recordOwnedPlaywright(playwright);
  const outcome = await raceInterruption(
    Promise.race([
      playwright.completion.then((result) => ({ kind: "playwright", result })),
      apiServer.spawned.completion.then(() => ({ kind: "server", server: apiServer })),
      webServer.spawned.completion.then(() => ({ kind: "server", server: webServer })),
    ]),
    interruptSignal,
  );
  if (outcome.kind === "server") {
    throw new Error(`PLATFORM_E2E_CHILD_EXITED:${outcome.server.label}`);
  }
  if (outcome.result.code !== 0) {
    throw new Error("PLATFORM_E2E_PLAYWRIGHT_FAILED");
  }
  await assertServerRunning(apiServer);
  await assertServerRunning(webServer);
}

async function cleanOwnedProcess(spawned, label) {
  try {
    await spawned.killGroup();
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

async function delayWhileRunning(
  dependencies,
  server,
  milliseconds,
  interruptSignal,
) {
  await raceServerExit(
    server,
    raceInterruption(
      dependencies.delay(milliseconds, interruptSignal),
      interruptSignal,
    ),
  );
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
  interruptSignal,
  onCompletion,
) {
  const result = await runCommandResult(
    dependencies,
    label,
    command,
    args,
    environment,
    interruptSignal,
    onCompletion,
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
  interruptSignal,
  onCompletion,
) {
  let spawned;
  try {
    throwIfInterrupted(interruptSignal);
    spawned = dependencies.spawn(command, args, {
      environment,
      kind: "command",
      label,
    });
    return await waitForOwnedProcess(
      spawned,
      label,
      interruptSignal,
      onCompletion,
    );
  } catch (error) {
    if (
      isInterruptionError(error) ||
      isCleanupError(error) ||
      isContainerOwnershipError(error)
    ) {
      throw error;
    }
    throw new Error(`PLATFORM_E2E_COMMAND_FAILED:${label}`);
  }
}

async function withCommandWatchdog(
  dependencies,
  timeoutMs,
  timeoutError,
  interruptSignal,
  operation,
) {
  const controller = new AbortController();
  const abortForInterruption = () => {
    controller.abort(getInterruptionError(interruptSignal));
  };
  if (interruptSignal?.aborted) {
    abortForInterruption();
  } else {
    interruptSignal?.addEventListener("abort", abortForInterruption, {
      once: true,
    });
  }
  const scheduleTimeout = dependencies.setTimeout ?? setTimeout;
  const cancelTimeout = dependencies.clearTimeout ?? clearTimeout;
  const timeout = scheduleTimeout(() => controller.abort(timeoutError), timeoutMs);
  timeout.unref?.();
  try {
    return await operation(controller.signal);
  } finally {
    cancelTimeout(timeout);
    interruptSignal?.removeEventListener("abort", abortForInterruption);
  }
}

async function waitForOwnedProcess(
  spawned,
  label,
  interruptSignal,
  onCompletion,
) {
  let failure;
  let failed = false;
  let result;
  try {
    result = await raceInterruption(spawned.completion, interruptSignal);
  } catch (error) {
    failed = true;
    failure = error;
  }
  if (!failed) {
    try {
      await onCompletion?.(result);
    } catch (error) {
      failed = true;
      failure = error;
    }
  }
  await cleanOwnedProcess(spawned, label);
  throwIfInterrupted(interruptSignal);
  if (failed) throw failure;
  return result;
}

async function raceInterruption(operation, interruptSignal) {
  if (interruptSignal === undefined) return await operation;
  throwIfInterrupted(interruptSignal);

  let onAbort;
  const interrupted = new Promise((resolveInterrupted) => {
    onAbort = () => resolveInterrupted({
      error: getInterruptionError(interruptSignal),
      kind: "interrupted",
    });
    interruptSignal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const outcome = await Promise.race([
      Promise.resolve(operation).then(
        (value) => ({ kind: "operation", value }),
        (error) => ({ error, kind: "operation-error" }),
      ),
      interrupted,
    ]);
    if (outcome.kind === "interrupted" || outcome.kind === "operation-error") {
      throw outcome.error;
    }
    return outcome.value;
  } finally {
    interruptSignal.removeEventListener("abort", onAbort);
  }
}

function throwIfInterrupted(interruptSignal) {
  if (interruptSignal?.aborted) {
    throw getInterruptionError(interruptSignal);
  }
}

function getInterruptionError(interruptSignal) {
  const reason = interruptSignal?.reason;
  if (reason instanceof Error) return reason;
  return new Error("PLATFORM_E2E_INTERRUPTED");
}

function isInterruptionError(error) {
  return error instanceof Error &&
    error.message.startsWith("PLATFORM_E2E_INTERRUPTED");
}

function isCleanupError(error) {
  return error instanceof Error &&
    error.message.startsWith("PLATFORM_E2E_CLEANUP_FAILED:");
}

function isContainerOwnershipError(error) {
  return error instanceof Error &&
    error.message.startsWith("PLATFORM_E2E_CONTAINER_ID_");
}

function isJsonContentType(value) {
  const mediaType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json" ||
    (mediaType?.startsWith("application/") === true && mediaType.endsWith("+json"));
}

function isExactReadinessBody(value, expectedStatus) {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    value.status === expectedStatus;
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
    delay: abortableDelay,
    fetch: globalThis.fetch,
    probePort: probePortFree,
    removeDirectory: rm,
    spawn: spawnProcess,
  };
}

export function spawnProcess(command, args, options) {
  const ownsProcessGroup =
    options.kind === "command" ||
    options.kind === "server" ||
    options.kind === "process-group";
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

function abortableDelay(milliseconds, interruptSignal) {
  return new Promise((resolveDelay, rejectDelay) => {
    let timeout;
    const onAbort = () => {
      clearTimeout(timeout);
      rejectDelay(getInterruptionError(interruptSignal));
    };
    if (interruptSignal?.aborted) {
      onAbort();
      return;
    }
    timeout = setTimeout(() => {
      interruptSignal?.removeEventListener("abort", onAbort);
      resolveDelay();
    }, milliseconds);
    interruptSignal?.addEventListener("abort", onAbort, { once: true });
  });
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

function probePortFree(host, port, interruptSignal) {
  return new Promise((resolveProbe, rejectProbe) => {
    const server = createServer();
    let settled = false;
    const settle = (error, value) => {
      if (settled) return;
      settled = true;
      interruptSignal?.removeEventListener("abort", onAbort);
      if (error === undefined) resolveProbe(value);
      else rejectProbe(error);
    };
    const onAbort = () => {
      try {
        server.close(() => settle(getInterruptionError(interruptSignal)));
      } catch {
        settle(getInterruptionError(interruptSignal));
      }
      settle(getInterruptionError(interruptSignal));
    };
    server.unref();
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        settle(undefined, false);
      } else {
        settle(error);
      }
    });
    server.listen({ exclusive: true, host, port }, () => {
      server.close((error) => {
        if (error === undefined) settle(undefined, true);
        else settle(error);
      });
    });
    if (interruptSignal?.aborted) {
      onAbort();
    } else {
      interruptSignal?.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export async function runPlatformE2EEntrypoint({
  controller = process,
  run = runPlatformE2E,
  runOptions = {},
} = {}) {
  const interruption = new AbortController();
  let receivedSignal;
  const handlers = new Map(
    INTERRUPT_SIGNALS.map((signal) => [signal, () => {
      if (receivedSignal !== undefined) return;
      receivedSignal = signal;
      interruption.abort(new Error(`PLATFORM_E2E_INTERRUPTED:${signal}`));
    }]),
  );
  for (const [signal, handler] of handlers) {
    controller.on(signal, handler);
  }
  try {
    await run({ ...runOptions, interruptSignal: interruption.signal });
    throwIfInterrupted(interruption.signal);
  } catch (error) {
    controller.stderr.write(`${normalizeError(error).message}\n`);
    controller.exitCode = receivedSignal === undefined
      ? 1
      : INTERRUPT_EXIT_CODES[receivedSignal];
  } finally {
    for (const [signal, handler] of handlers) {
      controller.removeListener(signal, handler);
    }
  }
}

function isEntrypoint() {
  return process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isEntrypoint()) {
  void runPlatformE2EEntrypoint();
}
