import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

import {
  createFilesystemBasicBatchCache,
  readBasicBatchCountryInput,
  readBasicBatchGlobalInput,
  readOptionalBasicBatchGlobalInput,
  readOptionalBasicBatchManualInput,
} from "./cli/basic-batch-filesystem-cache.js";

const roots = new Set<string>();
const SOURCE_ID = "global-wind-atlas";
const OBJECT_DIGEST = "a".repeat(64);

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe.skipIf(process.platform !== "linux")("BASIC batch bounded special-file reads", () => {
  test.each([
    ["global input", "global", "basic batch input is invalid"],
    ["optional global input", "optional-global", "basic batch input is invalid"],
    ["country input", "country", "basic batch input is invalid"],
    ["manual input", "manual", "basic batch input is invalid"],
    ["cache reference", "cache-ref", "basic batch cache is invalid"],
    ["cache object", "cache-object", "basic batch cache is invalid"],
  ] as const)("rejects a FIFO at the %s path without blocking", (_label, mode, expectedError) => {
    const root = createRoot();
    const fifo = preparePath(root, mode);
    const mkfifo = spawnSync("mkfifo", [fifo], { encoding: "utf8" });
    expect(mkfifo.status, mkfifo.stderr).toBe(0);

    const result = runReadInBoundedChild(root, mode);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(expectedError);
    expect(result.stdout).not.toContain(root);
  });

  test.each([
    ["global input", "global", "basic batch input is invalid"],
    ["optional global input", "optional-global", "basic batch input is invalid"],
    ["country input", "country", "basic batch input is invalid"],
    ["manual input", "manual", "basic batch input is invalid"],
  ] as const)("rejects a directory at the %s path with the uniform error", async (
    _label,
    mode,
    expectedError,
  ) => {
    const root = createRoot();
    const pathname = preparePath(root, mode);
    mkdirSync(pathname);

    await expect(readInputForMode(root, pathname, mode)).rejects.toThrow(expectedError);
  });

  test.each([
    ["cache reference", "cache-ref"],
    ["cache object", "cache-object"],
  ] as const)("rejects a directory at the %s path with the uniform error", async (_label, mode) => {
    const root = createRoot();
    const pathname = preparePath(root, mode);
    mkdirSync(pathname);

    await expect(createFilesystemBasicBatchCache(root, "batch-special-file").getOrCapture(
      SOURCE_ID,
      async () => new TextEncoder().encode("must-not-capture"),
    )).rejects.toThrow("basic batch cache is invalid");
  });
});

function createRoot(): string {
  const root = mkdtempSync(join(process.platform === "linux" ? "/tmp" : tmpdir(), "navigator-basic-fifo-"));
  roots.add(root);
  return root;
}

function preparePath(root: string, mode: string): string {
  if (mode === "global" || mode === "optional-global" || mode === "country" || mode === "manual") {
    const inputDirectory = join(root, "inputs");
    mkdirSync(inputDirectory, { mode: 0o700 });
    return join(inputDirectory, `${mode}.snapshot`);
  }

  const batchRoot = join(
    root,
    ".cache",
    "basic-country",
    "batches",
    "batch-special-file",
  );
  const objects = join(batchRoot, "objects");
  const refs = join(batchRoot, "refs");
  mkdirSync(objects, { recursive: true, mode: 0o700 });
  mkdirSync(refs, { recursive: true, mode: 0o700 });
  if (mode === "cache-ref") return join(refs, `${SOURCE_ID}.json`);
  writeFileSync(join(refs, `${SOURCE_ID}.json`), `${JSON.stringify({
    sourceId: SOURCE_ID,
    sha256: OBJECT_DIGEST,
    byteLength: 1,
  })}\n`, { mode: 0o600 });
  return join(objects, OBJECT_DIGEST);
}

function runReadInBoundedChild(root: string, mode: string) {
  const packageRoot = fileURLToPath(new URL("../", import.meta.url));
  const source = [
    "import { join } from 'node:path';",
    "import {",
    "  createFilesystemBasicBatchCache,",
    "  readBasicBatchCountryInput,",
    "  readBasicBatchGlobalInput,",
    "  readOptionalBasicBatchGlobalInput,",
    "  readOptionalBasicBatchManualInput,",
    "} from './src/cli/basic-batch-filesystem-cache.ts';",
    "const [root, mode] = process.argv.slice(1);",
    "const pathname = join(root, 'inputs', `${mode}.snapshot`);",
    "try {",
    "  if (mode === 'global') await readBasicBatchGlobalInput(root, pathname);",
    "  else if (mode === 'optional-global') await readOptionalBasicBatchGlobalInput(root, pathname);",
    "  else if (mode === 'country') await readBasicBatchCountryInput(root, pathname);",
    "  else if (mode === 'manual') await readOptionalBasicBatchManualInput(root, pathname);",
    "  else await createFilesystemBasicBatchCache(root, 'batch-special-file').getOrCapture(",
    `    '${SOURCE_ID}', async () => new TextEncoder().encode('must-not-capture'),`,
    "  );",
    "  process.stdout.write('unexpected success');",
    "  process.exitCode = 2;",
    "} catch (error) {",
    "  process.stdout.write(error instanceof Error ? error.message : 'non-error rejection');",
    "}",
  ].join("\n");
  return spawnSync(process.execPath, [
    "--conditions=development",
    "--import", "../../scripts/node-ts-source-hook.mjs",
    "--input-type=module",
    "--eval", source,
    root,
    mode,
  ], {
    cwd: packageRoot,
    encoding: "utf8",
    timeout: 1_000,
    killSignal: "SIGKILL",
  });
}

function readInputForMode(root: string, pathname: string, mode: string): Promise<Uint8Array | null> {
  if (mode === "global") return readBasicBatchGlobalInput(root, pathname);
  if (mode === "optional-global") return readOptionalBasicBatchGlobalInput(root, pathname);
  if (mode === "country") return readBasicBatchCountryInput(root, pathname);
  return readOptionalBasicBatchManualInput(root, pathname);
}
