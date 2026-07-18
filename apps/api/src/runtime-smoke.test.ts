import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

const SMOKE_PORT = 31876;
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const smokeScript = resolve(apiRoot, "scripts/runtime-smoke.mjs");

describe("runtime smoke", () => {
  test("fails instead of crediting a listener that already owns the fixed port", async () => {
    const unrelatedServer = createServer();
    await listen(unrelatedServer, SMOKE_PORT);

    try {
      const result = await runSmokeScript();

      expect(result.signal).toBeNull();
      expect(result.code).toBeTypeOf("number");
      expect(result.code).toBeGreaterThan(0);
      expect(result.stderr).toContain("API_RUNTIME_SMOKE_PORT_OCCUPIED");
    } finally {
      await close(unrelatedServer);
    }
  }, 15_000);
});

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function runSmokeScript(): Promise<{
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
}> {
  return new Promise((resolveExit, rejectExit) => {
    const child = spawn(process.execPath, [smokeScript], {
      cwd: apiRoot,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", rejectExit);
    child.once("exit", (code, signal) => resolveExit({ code, signal, stderr }));
  });
}
