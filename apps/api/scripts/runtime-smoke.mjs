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

try {
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

  const exit = waitForExit(child);
  await waitForListener(PORT, exit);
  child.kill("SIGTERM");

  const result = await exit;
  if (result.code !== 0 && result.signal !== "SIGTERM") {
    throw new Error("API_RUNTIME_SMOKE_EXIT_FAILED");
  }
} finally {
  if (child !== undefined && child.exitCode === null) {
    child.kill("SIGTERM");
  }
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function waitForExit(childProcess) {
  return new Promise((resolveExit, rejectExit) => {
    childProcess.once("error", rejectExit);
    childProcess.once("exit", (code, signal) => resolveExit({ code, signal }));
  });
}

async function waitForListener(port, exit) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await canConnect(port)) return;
    const result = await Promise.race([
      exit.then((value) => ({ type: "exit", value })),
      delay(100).then(() => ({ type: "retry" })),
    ]);
    if (result.type === "exit") {
      throw new Error("API_RUNTIME_SMOKE_LISTENER_FAILED");
    }
  }
  throw new Error("API_RUNTIME_SMOKE_LISTENER_TIMEOUT");
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
