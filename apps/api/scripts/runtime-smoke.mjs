import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 31876;
const COUNTRIES_REQUEST_TIMEOUT_MS = 1_000;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");

export async function runRuntimeSmoke() {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "navigator-api-smoke-"),
  );
  let child;
  let exit;

  try {
    await assertPortUnavailable(PORT);
    child = spawn(process.execPath, [resolve(scriptDirectory, "../dist/main.js")], {
      cwd: temporaryDirectory,
      env: {
        ...process.env,
        API_PORT: String(PORT),
        COUNTRY_READ_SOURCE: "canonical",
        CANONICAL_REPOSITORY_ROOT: repositoryRoot,
      },
      stdio: "ignore",
    });

    exit = waitForExit(child);
    await waitForCountriesResponse(PORT, child, exit);
    assertChildRunning(child);
    if (!child.kill("SIGTERM")) {
      throw new Error("API_RUNTIME_SMOKE_SIGNAL_FAILED");
    }

    const result = await exit;
    if (result.code !== null || result.signal !== "SIGTERM") {
      throw new Error("API_RUNTIME_SMOKE_EXIT_FAILED");
    }
  } finally {
    if (child !== undefined && isChildRunning(child)) {
      child.kill("SIGTERM");
    }
    if (exit !== undefined) {
      await exit.catch(() => undefined);
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (isEntrypoint()) {
  await runRuntimeSmoke();
}

async function assertPortUnavailable(port) {
  if (await canConnect(port)) {
    throw new Error("API_RUNTIME_SMOKE_PORT_OCCUPIED");
  }
}

function waitForExit(childProcess) {
  return new Promise((resolveExit, rejectExit) => {
    childProcess.once("error", rejectExit);
    childProcess.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForCountriesResponse(port, childProcess, exitPromise) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await hasValidCountriesResponse(port)) {
      assertChildRunning(childProcess);
      return;
    }
    const result = await Promise.race([
      exitPromise.then((value) => ({ type: "exit", value })),
      delay(100).then(() => ({ type: "retry" })),
    ]);
    if (result.type === "exit") {
      throw new Error("API_RUNTIME_SMOKE_COUNTRIES_FAILED");
    }
  }
  throw new Error("API_RUNTIME_SMOKE_COUNTRIES_TIMEOUT");
}

async function hasValidCountriesResponse(port) {
  const response = await requestCountries(port);
  if (response === null) {
    return false;
  }

  if (response.status !== 200) {
    throw new Error("API_RUNTIME_SMOKE_COUNTRIES_STATUS");
  }
  if (!/^application\/json\b/i.test(response.contentType)) {
    throw new Error("API_RUNTIME_SMOKE_COUNTRIES_CONTENT_TYPE");
  }

  let body;
  try {
    body = JSON.parse(response.body);
  } catch {
    throw new Error("API_RUNTIME_SMOKE_COUNTRIES_ENVELOPE");
  }
  if (
    body === null ||
    typeof body !== "object" ||
    body.success !== true ||
    !Array.isArray(body.data) ||
    body.meta === null ||
    typeof body.meta !== "object" ||
    body.meta.locale !== "en"
  ) {
    throw new Error("API_RUNTIME_SMOKE_COUNTRIES_ENVELOPE");
  }
  return true;
}

export function requestCountries(
  port,
  timeoutMilliseconds = COUNTRIES_REQUEST_TIMEOUT_MS,
) {
  return new Promise((resolveResponse) => {
    let incomingResponse;
    let req;
    let settled = false;
    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      incomingResponse?.destroy();
      req?.destroy();
      resolveResponse(result);
    };
    const timeout = setTimeout(
      () => settle(null),
      Math.max(1, timeoutMilliseconds),
    );
    timeout.unref();

    req = request(
      {
        agent: false,
        headers: { accept: "application/json" },
        host: "127.0.0.1",
        method: "GET",
        path: "/api/v1/countries?locale=en",
        port,
      },
      (response) => {
        incomingResponse = response;
        const chunks = [];
        response.setEncoding("utf8");
        response.on("data", (chunk) => chunks.push(chunk));
        response.once("aborted", () => settle(null));
        response.once("error", () => settle(null));
        response.once("end", () => settle({
          body: chunks.join(""),
          contentType: response.headers["content-type"] ?? "",
          status: response.statusCode ?? 0,
        }));
      },
    );
    req.once("error", () => settle(null));
    req.end();
  });
}

function isEntrypoint() {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    fileURLToPath(import.meta.url) === resolve(entrypoint)
  );
}

function assertChildRunning(childProcess) {
  if (!isChildRunning(childProcess)) {
    throw new Error("API_RUNTIME_SMOKE_CHILD_EXITED");
  }
}

function isChildRunning(childProcess) {
  return childProcess.exitCode === null && childProcess.signalCode === null;
}

function canConnect(port) {
  return new Promise((resolveConnection) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolveConnection(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolveConnection(false);
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
