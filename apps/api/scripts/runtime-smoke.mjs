import { mkdtemp, rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 31876;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "navigator-api-smoke-"));
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
  await waitForListener(PORT, child, exit);
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

async function waitForListener(port, childProcess, exitPromise) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      assertChildRunning(childProcess);
      return;
    }
    const result = await Promise.race([
      exitPromise.then((value) => ({ type: "exit", value })),
      delay(100).then(() => ({ type: "retry" })),
    ]);
    if (result.type === "exit") {
      throw new Error("API_RUNTIME_SMOKE_LISTENER_FAILED");
    }
  }
  throw new Error("API_RUNTIME_SMOKE_LISTENER_TIMEOUT");
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
