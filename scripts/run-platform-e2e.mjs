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
const READINESS_DELAY_MS = 250;

export async function runPlatformE2E({
  dependencies = createProductionDependencies(),
  environment = process.env,
  readinessAttempts = DEFAULT_READINESS_ATTEMPTS,
} = {}) {
  const externalDatabaseUrl = environment.DATABASE_URL;
  if (externalDatabaseUrl !== undefined) {
    requireSafeDatabaseUrl(externalDatabaseUrl);
  }
  if (!Number.isInteger(readinessAttempts) || readinessAttempts < 1) {
    throw new Error("PLATFORM_E2E_READINESS_ATTEMPTS_INVALID");
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
    await waitForCountries(dependencies, apiServer, readinessAttempts);

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
    await waitForWeb(dependencies, webServer, readinessAttempts);

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
    if (
      parsed.protocol !== "postgresql:" ||
      (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "[::1]") ||
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

async function waitForCountries(dependencies, server, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertServerRunning(server);
    let response;
    try {
      response = await raceServerExit(
        server,
        dependencies.fetch(
          `http://127.0.0.1:${API_PORT}/api/v1/countries?locale=en`,
          { redirect: "manual" },
        ),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PLATFORM_E2E_CHILD_EXITED:")) {
        throw error;
      }
      if (attempt + 1 === attempts) {
        throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_TIMEOUT");
      }
      await delayWhileRunning(dependencies, server, READINESS_DELAY_MS);
      continue;
    }
    if (
      response.status !== 200 ||
      !isJsonContentType(response.headers.get("content-type"))
    ) {
      cancelBody(response.body);
      throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
    }
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
    }
    if (!isSixCountryEnvelope(body)) {
      throw new Error("PLATFORM_E2E_COUNTRIES_READINESS_INVALID");
    }
    return;
  }
}

async function waitForWeb(dependencies, server, attempts) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await assertServerRunning(server);
    let response;
    try {
      response = await raceServerExit(
        server,
        dependencies.fetch(`http://127.0.0.1:${WEB_PORT}/en`, {
          redirect: "manual",
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("PLATFORM_E2E_CHILD_EXITED:")) {
        throw error;
      }
      if (attempt + 1 === attempts) {
        throw new Error("PLATFORM_E2E_WEB_READINESS_TIMEOUT");
      }
      await delayWhileRunning(dependencies, server, READINESS_DELAY_MS);
      continue;
    }
    cancelBody(response.body);
    if (response.status !== 200) {
      throw new Error("PLATFORM_E2E_WEB_READINESS_INVALID");
    }
    return;
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
      kind: "command",
      label: "playwright",
    },
  );
  const outcome = await Promise.race([
    playwright.completion.then((result) => ({ kind: "playwright", result })),
    apiServer.spawned.completion.then(() => ({ kind: "server", server: apiServer })),
    webServer.spawned.completion.then(() => ({ kind: "server", server: webServer })),
  ]);
  if (outcome.kind === "server") {
    throw new Error(`PLATFORM_E2E_CHILD_EXITED:${outcome.server.label}`);
  }
  if (outcome.result.code !== 0) {
    throw new Error("PLATFORM_E2E_PLAYWRIGHT_FAILED");
  }
  await assertServerRunning(apiServer);
  await assertServerRunning(webServer);
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
  return value !== null &&
    typeof value === "object" &&
    value.success === true &&
    Array.isArray(value.data) &&
    value.data.length === 6 &&
    value.meta !== null &&
    typeof value.meta === "object" &&
    value.meta.locale === "en" &&
    value.meta.total === 6;
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

function spawnProcess(command, args, options) {
  const child = spawnChildProcess(command, args, {
    cwd: resolve(import.meta.dirname, ".."),
    detached: options.kind === "server",
    env: options.environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let settled = false;
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
      settled = true;
      resolveCompletion({ code, signal, stdout });
    });
  });

  return {
    completion,
    killGroup: async () => {
      if (settled) return;
      if (child.pid === undefined) {
        throw new Error("PLATFORM_E2E_PROCESS_PID_MISSING");
      }
      signalProcessGroup(child.pid, "SIGTERM");
      const graceful = await Promise.race([
        completion.then(() => true),
        new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 10_000)),
      ]);
      if (!graceful) {
        signalProcessGroup(child.pid, "SIGKILL");
        const killed = await Promise.race([
          completion.then(() => true),
          new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(false), 5_000)),
        ]);
        if (!killed) {
          throw new Error("PLATFORM_E2E_PROCESS_GROUP_STUCK");
        }
      }
    },
    pid: child.pid,
  };
}

function signalProcessGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
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
