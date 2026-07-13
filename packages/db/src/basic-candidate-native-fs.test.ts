import { constants } from "node:fs";
import {
  chmod,
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
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
      )).toThrow(FIXED_ERROR);

      await writeFile(NATIVE_BINARY, "not a native addon", { mode: 0o500 });
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
      )).toThrow(FIXED_ERROR);
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
    try {
      renameBasicCandidateDirectoryChildNoReplaceNative(parent.fd, "source", "target");
    } finally {
      await parent.close();
    }

    expect(await readdir(root)).toEqual(["target"]);
    expect(await readFile(join(root, "target", "artifact.json"), "utf8")).toBe("complete");
  });

  test("does not overwrite an existing empty target and preserves the source", async () => {
    const root = await createTemporaryRoot();
    await mkdir(join(root, "source"), { mode: 0o700 });
    await mkdir(join(root, "target"), { mode: 0o700 });
    await writeFile(join(root, "source", "artifact.json"), "source", { mode: 0o600 });
    const parent = await openDirectory(root);
    try {
      expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
        parent.fd,
        "source",
        "target",
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
      const first = runWorker(parent.fd, "source-a", barrier);
      const second = runWorker(parent.fd, "source-b", barrier);
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
        )).toThrow(FIXED_ERROR);
      }
      for (const name of invalidNames) {
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          name,
          "target",
        )).toThrow(FIXED_ERROR);
        expect(() => renameBasicCandidateDirectoryChildNoReplaceNative(
          parent.fd,
          "source",
          name,
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
      )).toThrow(FIXED_ERROR);
      expect(accessed).toBe(false);
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

    expect(wrapperSource).not.toMatch(/node:child_process|node:fs\/promises|copyFile|EXDEV/);
    expect(nativeSource).toContain("SYS_renameat2");
    expect(nativeSource).toContain("RENAME_NOREPLACE");
    expect(nativeSource).toContain("fstat");
    expect(nativeSource).toContain("S_ISDIR");
    expect(nativeSource).not.toMatch(/\b(?:rename|renameat|copy_file_range|sendfile)\s*\(/);
    expect(nativeSource).not.toMatch(/\b(?:system|popen|fork|execv|execve|execl|execlp)\s*\(/);
  });
});

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

async function waitForWorkers(view: Int32Array, expected: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Atomics.load(view, 0) < expected) {
    if (Date.now() >= deadline) throw new Error("workers did not reach the barrier");
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
}
