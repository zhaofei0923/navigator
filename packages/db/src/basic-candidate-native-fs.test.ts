import { constants } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, test } from "vitest";

import {
  closeBasicCandidateNativeDirectory,
  createBasicCandidateExclusiveDirectoryNative,
  ensureBasicCandidateDirectoryNative,
  renameBasicCandidateDirectoryChildNoReplaceNative,
} from "./cli/basic-candidate-native-fs.js";

const FIXED_ERROR = "basic candidate native filesystem operation failed";
const TEST_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIRECTORY = resolve(TEST_DIRECTORY, "..");
const NATIVE_BINARY = join(
  PACKAGE_DIRECTORY,
  ".cache",
  "native",
  "basic-candidate-fs.node",
);
const WRAPPER_URL = pathToFileURL(join(
  TEST_DIRECTORY,
  "cli",
  "basic-candidate-native-fs.ts",
)).href;
const temporaryRoots: string[] = [];

describe("Basic candidate native no-replace publisher", () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((pathname) =>
      rm(pathname, { recursive: true, force: true })
    ));
  });

  test("redacts missing and invalid native addon loads", async () => {
    const root = await createTemporaryRoot();
    const parent = await openDirectory(root);
    const heldBinary = `${NATIVE_BINARY}.held`;
    try {
      await rename(NATIVE_BINARY, heldBinary);
      expect(runIsolatedNativeLoad("missing"))
        .toEqual({ status: "failed", message: FIXED_ERROR });

      await writeFile(NATIVE_BINARY, "not a native addon", { mode: 0o500 });
      expect(runIsolatedNativeLoad("invalid"))
        .toEqual({ status: "failed", message: FIXED_ERROR });
    } finally {
      await rm(NATIVE_BINARY, { force: true });
      await rename(heldBinary, NATIVE_BINARY);
      await parent.close();
    }
  });

  test("publishes a sibling directory through its open parent descriptor", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "source"), { mode: 0o700 });
    await writeFile(join(root, "source", "artifact.json"), "complete", { mode: 0o600 });
    const parent = await openDirectory(root);
    const source = await directoryIdentity(root, "source");
    try {
      renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
        source.dev,
        source.ino,
      );
    } finally {
      await parent.close();
    }

    expect(await readdir(root)).toEqual(["target"]);
    expect(await readFile(join(root, "target", "artifact.json"), "utf8")).toBe("complete");
  });

  test("allows cooperating creators to ensure one held directory identity", async () => {
    const root = await createTemporaryRoot();
    const parent = await openDirectory(root);
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    try {
      const first = runEnsureWorker(parent.fd, "country", barrier);
      const second = runEnsureWorker(parent.fd, "country", barrier);
      const view = new Int32Array(barrier);
      await waitForWorkers(view, 2);
      Atomics.store(view, 1, 1);
      Atomics.notify(view, 1, 2);

      const results = await Promise.all([first, second]);
      expect(results.map(({ created }) => created).sort()).toEqual([false, true]);
      expect(new Set(results.map(({ dev, ino }) => `${dev}:${ino}`))).toHaveLength(1);
      expect(await readdir(root)).toEqual(["country"]);
    } finally {
      await parent.close();
    }
  }, 15_000);

  test("creates and holds an exclusive sibling directory before returning", async () => {
    const root = await createTemporaryRoot();
    const parent = await openDirectory(root);
    const created = createBasicCandidateExclusiveDirectoryNative(parent.fd, "private-temp");
    try {
      const details = await lstat(`/proc/self/fd/${created.fd}/`);
      expect(details.isDirectory()).toBe(true);
      expect(BigInt(details.dev)).toBe(created.dev);
      expect(BigInt(details.ino)).toBe(created.ino);
      await rename(join(root, "private-temp"), join(root, "private-temp-held"));
      await mkdir(join(root, "private-temp"), { mode: 0o700 });
      expect((await lstat(`/proc/self/fd/${created.fd}/`)).ino).toBe(details.ino);
    } finally {
      closeBasicCandidateNativeDirectory(created);
      await parent.close();
    }
  });

  test("does not leak raw descriptors across repeated create and ensure cycles", async () => {
    const root = await createTemporaryRoot();
    const parent = await openDirectory(root);
    const before = (await readdir("/proc/self/fd")).length;
    try {
      for (let index = 0; index < 32; index += 1) {
        const created = createBasicCandidateExclusiveDirectoryNative(
          parent.fd,
          `exclusive-${index}`,
        );
        closeBasicCandidateNativeDirectory(created);
      }
      for (let index = 0; index < 64; index += 1) {
        const ensured = ensureBasicCandidateDirectoryNative(parent.fd, "ensured");
        closeBasicCandidateNativeDirectory(ensured);
      }
    } finally {
      await parent.close();
    }
    const after = (await readdir("/proc/self/fd")).length;

    expect(after).toBe(before - 1);
  });

  test("keeps using the eagerly loaded addon after its source pathname is swapped", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "source"), { mode: 0o700 });
    const parent = await openDirectory(root);
    const source = await directoryIdentity(root, "source");
    const heldBinary = `${NATIVE_BINARY}.held`;
    try {
      await rename(NATIVE_BINARY, heldBinary);

      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
        source.dev,
        source.ino,
      )).not.toThrow();
    } finally {
      await rm(NATIVE_BINARY, { force: true });
      await rename(heldBinary, NATIVE_BINARY);
      await parent.close();
    }

    expect(await readdir(root)).toEqual(["target"]);
  });

  test("loads bytes from the held addon fd when the exact pathname is replaced", () => {
    expect(runIsolatedDlopenReplacement()).toEqual({ status: "loaded" });
  });

  test("rejects a source replacement detected immediately before publication", async () => {
    const root = await createTemporaryRoot();
    await createPayload(root, "source", "original");
    const expected = await directoryIdentity(root, "source");
    await rename(join(root, "source"), join(root, "held-original"));
    await createPayload(root, "source", "replacement");
    const parent = await openDirectory(root);
    try {
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
        expected.dev,
        expected.ino,
      )).toThrow(FIXED_ERROR);
    } finally {
      await parent.close();
    }

    expect(await readPayload(root, "source")).toEqual(["replacement", "replacement"]);
    expect(await readPayload(root, "held-original")).toEqual(["original", "original"]);
    await expect(readdir(join(root, "target"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("does not overwrite an existing empty target and preserves the source", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "source"), { mode: 0o700 });
    await mkdir(join(root, "target"), { mode: 0o700 });
    await writeFile(join(root, "source", "artifact.json"), "source", { mode: 0o600 });
    const parent = await openDirectory(root);
    const source = await directoryIdentity(root, "source");
    try {
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
        source.dev,
        source.ino,
      )).toThrow(FIXED_ERROR);
    } finally {
      await parent.close();
    }

    expect(await readdir(join(root, "target"))).toEqual([]);
    expect(await readFile(join(root, "source", "artifact.json"), "utf8")).toBe("source");
  });

  test("allows exactly one concurrent winner and preserves the complete loser", async () => {
    const root = await createTemporaryRoot();
    await createPayload(root, "source-a", "a");
    await createPayload(root, "source-b", "b");
    const parent = await openDirectory(root);
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    try {
      const first = runWorker(parent.fd, "source-a", await directoryIdentity(root, "source-a"), barrier);
      const second = runWorker(parent.fd, "source-b", await directoryIdentity(root, "source-b"), barrier);
      const view = new Int32Array(barrier);
      await waitForWorkers(view, 2);
      Atomics.store(view, 1, 1);
      Atomics.notify(view, 1, 2);

      const results = await Promise.all([first, second]);
      const winners = results.filter((result) => result.status === "won");
      const losers = results.filter((result) => result.status === "lost");
      expect(winners).toHaveLength(1);
      expect(losers).toEqual([{ status: "lost", message: FIXED_ERROR }]);

      const winnerName = winners[0]?.source;
      const loserName = winnerName === "source-a" ? "source-b" : "source-a";
      const winnerContent = winnerName === "source-a" ? "a" : "b";
      const loserContent = loserName === "source-a" ? "a" : "b";
      expect(await readPayload(root, "target")).toEqual([winnerContent, winnerContent]);
      expect(await readPayload(root, loserName)).toEqual([loserContent, loserContent]);
      await expect(readdir(join(root, winnerName ?? "missing"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await parent.close();
    }
  }, 15_000);

  test("rejects invalid descriptors and components with one fixed error", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "source"), { mode: 0o700 });
    const parent = await openDirectory(root);
    const regularFile = await open(join(root, "ordinary-file"), "w+", 0o600);
    const invalidNames: readonly unknown[] = Object.freeze([
      "",
      ".",
      "..",
      "nested/name",
      "nested\\name",
      "nul\0name",
      "x".repeat(256),
      "\ud800",
      1,
      null,
    ]);
    try {
      for (const descriptor of [-1, 1.5, Number.NaN, 0x8000_0000, regularFile.fd]) {
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          descriptor,
          "source",
          "target",
          1n,
          1n,
        )).toThrow(FIXED_ERROR);
      }
      for (const name of invalidNames) {
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          name,
          "target",
          1n,
          1n,
        )).toThrow(FIXED_ERROR);
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          "source",
          name,
          1n,
          1n,
        )).toThrow(FIXED_ERROR);
      }

      let accessed = false;
      const hostile = new Proxy(Object.create(null) as object, {
        get() {
          accessed = true;
          throw new Error("SECRET accessor value");
        },
      });
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        hostile,
        "target",
        1n,
        1n,
      )).toThrow(FIXED_ERROR);
      expect(accessed).toBe(false);

      for (const identity of [-1n, 0x1_0000_0000_0000_0000n, 1, null]) {
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          "source",
          "target",
          identity,
          1n,
        )).toThrow(FIXED_ERROR);
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          "source",
          "target",
          1n,
          identity,
        )).toThrow(FIXED_ERROR);
      }
    } finally {
      await regularFile.close();
      await parent.close();
    }
  });

  test("contains no ordinary rename, copy, EXDEV, shell, or child-process fallback", async () => {
    const wrapperSource = await readFile(join(
      TEST_DIRECTORY,
      "cli",
      "basic-candidate-native-fs.ts",
    ), "utf8");
    const nativeSource = await readFile(join(
      PACKAGE_DIRECTORY,
      "native",
      "basic-candidate-fs.c",
    ), "utf8");
    const buildSource = await readFile(join(
      PACKAGE_DIRECTORY,
      "scripts",
      "build-basic-candidate-native.mjs",
    ), "utf8");

    expect(wrapperSource).not.toMatch(/node:child_process|node:fs\/promises|copyFile|EXDEV/);
    expect(wrapperSource).toContain("process.dlopen");
    expect(wrapperSource).toContain("/proc/self/fd/");
    expect(wrapperSource).not.toContain("require(NATIVE_PATH)");
    expect(nativeSource).toContain("SYS_renameat2");
    expect(nativeSource).toContain("RENAME_NOREPLACE");
    expect(nativeSource).toContain("fstat");
    expect(nativeSource).toContain("fstatat");
    expect(nativeSource).toContain("S_ISDIR");
    expect(nativeSource).not.toMatch(/\b(?:rename|renameat|copy_file_range|sendfile)\s*\(/);
    expect(nativeSource).not.toMatch(/\b(?:system|popen|fork|execv|execve|execl|execlp)\s*\(/);
    expect(buildSource).toContain("execFileSync");
    expect(buildSource).toContain("/proc/self/fd/");
    expect(buildSource).toContain("O_NOFOLLOW");
    expect(buildSource).not.toMatch(/\brm\s*\(|recursive\s*:/);
  });
});

function runIsolatedNativeLoad(
  cacheKey: string,
): Readonly<{ status: "failed"; message: string }> {
  const output = execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      void import(${JSON.stringify(`${WRAPPER_URL}?${cacheKey}`)}).then((nativeFs) => {
      try {
        nativeFs.renameBasicCandidateDirectoryChildNoReplaceNative(
          0,
          "source",
          "target",
        );
        process.stdout.write(JSON.stringify({ status: "unexpected-success", message: "" }));
      } catch (error) {
        process.stdout.write(JSON.stringify({
          status: "failed",
          message: error instanceof Error ? error.message : "non-error",
        }));
      }
    }).catch((error) => {
      process.stdout.write(JSON.stringify({
        status: "failed",
        message: error instanceof Error ? error.message : "non-error",
      }));
    });
    `,
  ], { encoding: "utf8" });
  return JSON.parse(output) as Readonly<{ status: "failed"; message: string }>;
}

function runIsolatedDlopenReplacement(): Readonly<{ status: string }> {
  const heldBinary = `${NATIVE_BINARY}.dlopen-held`;
  const output = execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `
      import {
        chmodSync, closeSync, constants, openSync, renameSync, rmSync,
        rmdirSync, writeFileSync,
      } from "node:fs";
      const nativePath = ${JSON.stringify(NATIVE_BINARY)};
      const heldPath = ${JSON.stringify(heldBinary)};
      const originalDlopen = process.dlopen;
      process.dlopen = function(module, filename, flags) {
        renameSync(nativePath, heldPath);
        writeFileSync(nativePath, "replacement", { mode: 0o500 });
        chmodSync(nativePath, 0o500);
        try {
          return flags === undefined
            ? originalDlopen.call(process, module, filename)
            : originalDlopen.call(process, module, filename, flags);
        } finally {
          rmSync(nativePath, { force: true });
          renameSync(heldPath, nativePath);
        }
      };
      void import(${JSON.stringify(`${WRAPPER_URL}?descriptor-bound`)}).then((nativeFs) => {
        const root = ${JSON.stringify("/tmp")};
        const parent = openSync(root, constants.O_RDONLY | constants.O_DIRECTORY);
        const name = "basic-candidate-dlopen-" + process.pid;
        try {
          const directory = nativeFs.ensureBasicCandidateDirectoryNative(parent, name);
          nativeFs.closeBasicCandidateNativeDirectory(directory);
          rmdirSync(root + "/" + name);
          process.stdout.write(JSON.stringify({ status: "loaded" }));
        } catch (error) {
          process.stdout.write(JSON.stringify({
            status: error instanceof Error ? error.message : "failed",
          }));
        } finally {
          closeSync(parent);
        }
      }).catch((error) => process.stdout.write(JSON.stringify({
        status: error instanceof Error ? error.message : "failed",
      })));
    `,
  ], { encoding: "utf8" });
  return JSON.parse(output) as Readonly<{ status: string }>;
}

type WorkerResult = Readonly<
  | { status: "won"; source: string }
  | { status: "lost"; message: string }
>;

async function createTemporaryRoot(): Promise<string> {
  const root = await mkdtemp("/tmp/basic-candidate-native-");
  temporaryRoots.push(root);
  await chmod(root, 0o700);
  return root;
}

function openDirectory(pathname: string) {
  return open(
    pathname,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
}

async function createPayload(root: string, name: string, content: string): Promise<void> {
  await mkdir(join(root, name), { mode: 0o700 });
  await writeFile(join(root, name, "first.json"), content, { mode: 0o600 });
  await writeFile(join(root, name, "second.json"), content, { mode: 0o600 });
}

async function readPayload(root: string, name: string): Promise<readonly string[]> {
  return Promise.all([
    readFile(join(root, name, "first.json"), "utf8"),
    readFile(join(root, name, "second.json"), "utf8"),
  ]);
}

function runWorker(
  parentDirFd: number,
  source: string,
  expected: Readonly<{ dev: bigint; ino: bigint }>,
  barrier: SharedArrayBuffer,
): Promise<WorkerResult> {
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    void import(workerData.wrapperUrl).then((nativeFs) => {
      const view = new Int32Array(workerData.barrier);
      Atomics.add(view, 0, 1);
      Atomics.notify(view, 0, 1);
      Atomics.wait(view, 1, 0);
      try {
        nativeFs.renameBasicCandidateDirectoryChildNoReplaceNative(
          workerData.parentDirFd,
          workerData.source,
          "target",
          BigInt(workerData.dev),
          BigInt(workerData.ino),
        );
        parentPort.postMessage({ status: "won", source: workerData.source });
      } catch (error) {
        parentPort.postMessage({
          status: "lost",
          message: error instanceof Error ? error.message : "non-error",
        });
      }
    }).catch((error) => {
      parentPort.postMessage({
        status: "lost",
        message: error instanceof Error ? error.message : "non-error",
      });
    });
  `, {
    eval: true,
    workerData: {
      barrier,
      parentDirFd,
      source,
      dev: expected.dev.toString(),
      ino: expected.ino.toString(),
      wrapperUrl: WRAPPER_URL,
    },
  });
  return new Promise<WorkerResult>((resolveResult, reject) => {
    worker.once("message", (value: unknown) => resolveResult(value as WorkerResult));
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

function runEnsureWorker(
  parentDirFd: number,
  name: string,
  barrier: SharedArrayBuffer,
): Promise<Readonly<{ created: boolean; dev: string; ino: string }>> {
  const worker = new Worker(`
    const { parentPort, workerData } = require("node:worker_threads");
    void import(workerData.wrapperUrl).then((nativeFs) => {
      const view = new Int32Array(workerData.barrier);
      Atomics.add(view, 0, 1);
      Atomics.notify(view, 0, 1);
      Atomics.wait(view, 1, 0);
      const directory = nativeFs.ensureBasicCandidateDirectoryNative(
        workerData.parentDirFd,
        workerData.name,
      );
      try {
        parentPort.postMessage({
          created: directory.created,
          dev: directory.dev.toString(),
          ino: directory.ino.toString(),
        });
      } finally {
        nativeFs.closeBasicCandidateNativeDirectory(directory);
      }
    }).catch((error) => parentPort.postMessage({
      error: error instanceof Error ? error.message : "non-error",
    }));
  `, {
    eval: true,
    workerData: { barrier, name, parentDirFd, wrapperUrl: WRAPPER_URL },
  });
  return new Promise((resolveResult, reject) => {
    worker.once("message", (value: unknown) => {
      if (
        typeof value === "object" && value !== null && "error" in value
      ) reject(new Error(String(value.error)));
      else resolveResult(value as Readonly<{ created: boolean; dev: string; ino: string }>);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code !== 0) reject(new Error(`worker exited with code ${code}`));
    });
  });
}

async function directoryIdentity(
  root: string,
  name: string,
): Promise<Readonly<{ dev: bigint; ino: bigint }>> {
  const details = await lstat(join(root, name), { bigint: true });
  return Object.freeze({ dev: details.dev, ino: details.ino });
}

async function waitForWorkers(view: Int32Array, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Atomics.load(view, 0) < expected) {
    if (Date.now() >= deadline) throw new Error("workers did not reach the barrier");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
