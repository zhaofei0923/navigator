import {
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const productionCandidates = vi.hoisted(() => new WeakSet<object>());

vi.mock("./cli/basic-candidate-composition.js", () => ({
  isBasicCandidateProductionResult(value: unknown) {
    return typeof value === "object" && value !== null && productionCandidates.has(value);
  },
}));

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import { createBasicDeterministicFailureResult } from "./collection/basic-deterministic-candidate-result.js";
import { createBasicDeterministicSuccessResult } from "./collection/basic-deterministic-candidate-result.js";
import {
  writeBasicCandidateArtifacts as writeBasicCandidateArtifactsWithWorkspace,
} from "./cli/basic-candidate-artifact-writer.js";
import {
  closeBasicCandidateWorkspace,
  openBasicCandidateWorkspace,
  type BasicCandidateWorkspace,
} from "./cli/basic-candidate-workspace.js";

const nativePublishProbe = vi.hoisted(() => ({
  calls: 0,
  createCalls: 0,
  ensureCalls: [] as string[],
  pendingEnsureName: null as string | null,
  ensuredHandles: new Map<unknown, string>(),
  createTargetBeforeCall: false,
  replaceAfterCreate: false,
  replaceAfterEnsure: null as string | null,
  published: false,
  expectedIdentity: null as Readonly<{ dev: bigint; ino: bigint }> | null,
  postRenameArtifactReads: 0,
  postRenameParentSyncs: 0,
  postRenameTargetChecks: 0,
}));

vi.mock("./cli/basic-candidate-native-fs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-native-fs.js")>();
  return {
    ...actual,
    ensureBasicCandidateDirectoryNative(
      parentDirFd: unknown,
      name: unknown,
      expectedMode: unknown,
    ) {
      if (typeof name === "string") nativePublishProbe.ensureCalls.push(name);
      const ensured = actual.ensureBasicCandidateDirectoryNative(
        parentDirFd,
        name,
        expectedMode,
      );
      if (
        nativePublishProbe.replaceAfterEnsure === name &&
        typeof parentDirFd === "number" && typeof name === "string"
      ) {
        const pathname = `/proc/self/fd/${parentDirFd}/${name}`;
        renameSync(pathname, `${pathname}.held`);
        mkdirSync(pathname, { mode: 0o700 });
        writeFileSync(`${pathname}/owner.txt`, "foreign", { mode: 0o600 });
      }
      nativePublishProbe.pendingEnsureName = typeof name === "string" ? name : null;
      return ensured;
    },
    createBasicCandidateExclusiveDirectoryNative(
      parentDirFd: unknown,
      name: unknown,
    ) {
      nativePublishProbe.createCalls += 1;
      const created = actual.createBasicCandidateExclusiveDirectoryNative(
        parentDirFd,
        name,
      );
      if (
        nativePublishProbe.replaceAfterCreate &&
        typeof parentDirFd === "number" && typeof name === "string"
      ) {
        const pathname = `/proc/self/fd/${parentDirFd}/${name}`;
        renameSync(pathname, `${pathname}.held`);
        mkdirSync(pathname, { mode: 0o700 });
        writeFileSync(`${pathname}/owner.txt`, "foreign", { mode: 0o600 });
      }
      return created;
    },
    renameBasicCandidateDirectoryChildNoReplaceNative(
      parentDirFd: unknown,
      oldName: unknown,
      newName: unknown,
      expectedDev: unknown,
      expectedIno: unknown,
    ) {
      nativePublishProbe.calls += 1;
      if (fsFailure.mode === "exdev") {
        throw new Error("SECRET native no-replace unsupported");
      }
      if (
        nativePublishProbe.createTargetBeforeCall &&
        typeof parentDirFd === "number" &&
        typeof newName === "string"
      ) {
        mkdirSync(`/proc/self/fd/${parentDirFd}/${newName}`, { mode: 0o700 });
      }
      const result = actual.renameBasicCandidateDirectoryChildNoReplaceNative(
        parentDirFd,
        oldName,
        newName,
        expectedDev,
        expectedIno,
      );
      nativePublishProbe.published = true;
      if (typeof expectedDev === "bigint" && typeof expectedIno === "bigint") {
        nativePublishProbe.expectedIdentity = Object.freeze({
          dev: expectedDev,
          ino: expectedIno,
        });
      }
      return result;
    },
  };
});

const fsFailure = vi.hoisted(() => ({
  mode: "none" as
    | "none"
    | "partial"
    | "exdev"
    | "target-nonempty-replacement"
    | "target-empty-replacement",
  directorySyncError: null as null | "EACCES" | "EPERM" | "ENOTSUP",
  directorySyncParentOnly: false,
  rejectDirectoryOpen: false,
  rejectRecursiveRm: false,
  rejectDescendantsOf: null as string | null,
  ancestor: null as null | {
    pathname: string;
    outside: string;
    moved: boolean;
  },
  targetReplacementDone: false,
  failPostRenameVerification: false,
  failPostRenameParentSync: false,
  renameCalls: 0,
  openHandles: new Set<unknown>(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { constants } = await import("node:fs");
  return {
    ...actual,
    async mkdir(
      pathname: Parameters<typeof actual.mkdir>[0],
      options?: Parameters<typeof actual.mkdir>[1],
    ) {
      const result = await actual.mkdir(pathname, options);
      const candidate = String(pathname);
      if (
        fsFailure.mode === "target-nonempty-replacement" &&
        !fsFailure.targetReplacementDone &&
        candidate.endsWith("/run-001")
      ) {
        fsFailure.targetReplacementDone = true;
        await actual.rename(candidate, `${candidate}.attacker`);
        await actual.mkdir(candidate, { mode: 0o700 });
        await actual.writeFile(`${candidate}/owner.txt`, "attacker", { mode: 0o600 });
      }
      return result;
    },
    async open(
      pathname: Parameters<typeof actual.open>[0],
      flags: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) {
      const candidate = String(pathname);
      if (
        fsFailure.rejectDescendantsOf !== null &&
        candidate.startsWith(fsFailure.rejectDescendantsOf) &&
        candidate !== fsFailure.rejectDescendantsOf
      ) {
        throw new Error("SECRET direct descendant open");
      }
      const isExclusive = flags === "wx" ||
        (typeof flags === "number" && (flags & constants.O_EXCL) !== 0);
      const isDirectory = typeof flags === "number" &&
        (flags & constants.O_DIRECTORY) !== 0;
      if (nativePublishProbe.published && isDirectory && candidate.endsWith("/run-001")) {
        nativePublishProbe.postRenameTargetChecks += 1;
        if (fsFailure.failPostRenameVerification) {
          throw new Error("SECRET post-rename target verification failure");
        }
      }
      if (fsFailure.rejectDirectoryOpen && isDirectory) {
        const error = new Error("SECRET directory open failure") as NodeJS.ErrnoException;
        error.code = "EPERM";
        throw error;
      }
      if (
        fsFailure.mode === "partial" && isExclusive &&
        candidate.endsWith("extracted-facts.json")
      ) throw new Error("SECRET partial write failure");
      const handle = await actual.open(pathname, flags, mode);
      if (isDirectory && nativePublishProbe.pendingEnsureName !== null) {
        nativePublishProbe.ensuredHandles.set(handle, nativePublishProbe.pendingEnsureName);
        nativePublishProbe.pendingEnsureName = null;
      }
      if (nativePublishProbe.published && candidate.endsWith(".json")) {
        nativePublishProbe.postRenameArtifactReads += 1;
      }
      const close = handle.close.bind(handle);
      fsFailure.openHandles.add(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async () => {
          try {
            await close();
          } finally {
              fsFailure.openHandles.delete(handle);
              nativePublishProbe.ensuredHandles.delete(handle);
          }
        },
      });
      const ancestor = fsFailure.ancestor;
      if (
        ancestor !== null && !ancestor.moved && isDirectory &&
        candidate.endsWith("/data")
      ) {
        ancestor.moved = true;
        await actual.rename(ancestor.pathname, `${ancestor.pathname}.displaced`);
        await actual.symlink(ancestor.outside, ancestor.pathname, "dir");
      }
      if (
        fsFailure.mode === "target-empty-replacement" &&
        !fsFailure.targetReplacementDone && isDirectory &&
        candidate.endsWith("/run-001")
      ) {
        fsFailure.targetReplacementDone = true;
        await actual.rename(candidate, `${candidate}.attacker`);
        await actual.mkdir(candidate, { mode: 0o700 });
      }
      const directorySyncError = fsFailure.directorySyncError;
      if (
        isDirectory && directorySyncError !== null &&
        (!fsFailure.directorySyncParentOnly ||
          nativePublishProbe.ensuredHandles.get(handle) === "example-land")
      ) {
        Object.defineProperty(handle, "sync", {
          configurable: true,
          value: async () => {
            const error = new Error("SECRET directory sync failure") as NodeJS.ErrnoException;
            error.code = directorySyncError;
            throw error;
          },
        });
      }
      if (
        isDirectory && nativePublishProbe.ensuredHandles.get(handle) === "example-land"
      ) {
        const sync = handle.sync.bind(handle);
        Object.defineProperty(handle, "sync", {
          configurable: true,
          value: async () => {
            if (nativePublishProbe.published) {
              nativePublishProbe.postRenameParentSyncs += 1;
              if (fsFailure.failPostRenameParentSync) {
                throw new Error("SECRET post-rename parent sync failure");
              }
            }
            await sync();
          },
        });
      }
      return handle;
    },
    async rename(oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) {
      fsFailure.renameCalls += 1;
      if (fsFailure.mode === "exdev") {
        const error = new Error("SECRET cross-device path") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      }
      return actual.rename(oldPath, newPath);
    },
    async rm(
      pathname: Parameters<typeof actual.rm>[0],
      options?: Parameters<typeof actual.rm>[1],
    ) {
      if (fsFailure.rejectRecursiveRm) {
        throw new Error("SECRET recursive cleanup is forbidden");
      }
      return actual.rm(pathname, options);
    },
  };
});

const temporaryRoots: string[] = [];

describe("Basic candidate atomic artifact writer", () => {
  beforeEach(() => {
    resetFilesystemProbe();
  });

  afterEach(async () => {
    expect(fsFailure.openHandles.size).toBe(0);
    resetFilesystemProbe();
    await Promise.all(temporaryRoots.splice(0).map((pathname) =>
      rm(pathname, { recursive: true, force: true })
    ));
  });

  test("atomically writes exactly four mode-0600 files to isolated staging", async () => {
    const repoRoot = await createRepoRoot();
    const candidate = await readyCandidate();

    const result = await writeBasicCandidateArtifacts({ repoRoot, candidate });

    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    expect(result).toEqual({ status: "written" });
    expect((await lstat(target)).mode & 0o777).toBe(0o700);
    expect(await readdir(target)).toEqual([
      "extracted-facts.json",
      "market-overview.draft.json",
      "review-report.json",
      "source-register.json",
    ]);
    for (const name of await readdir(target)) {
      const details = await lstat(join(target, name));
      expect(details.isFile()).toBe(true);
      expect(details.mode & 0o777).toBe(0o600);
      const content = await readFile(join(target, name), "utf8");
      expect(() => JSON.parse(content)).not.toThrow();
    }
    expect(await pathExists(join(target, "collection-manifest.json"))).toBe(false);
    expect(await pathExists(join(repoRoot, "data", "example-land"))).toBe(false);
    expect((await readFile(join(target, "source-register.json"), "utf8"))).toMatch(
      /"schemaVersion":"basic-country-audit\/v2"/,
    );
    expect(fsFailure.renameCalls).toBe(0);
  });

  test("writes only through an already verified workspace capability", async () => {
    const repoRoot = await createRepoRoot();
    const workspace = await openBasicCandidateWorkspace(repoRoot);
    try {
      await expect(writeBasicCandidateArtifacts({
        workspace,
        candidate: await readyCandidate(),
      } as never)).resolves.toEqual({ status: "written" });
    } finally {
      await closeBasicCandidateWorkspace(workspace);
    }
  });

  test("rejects blocked and forged candidate results before creating staging", async () => {
    const repoRoot = await createRepoRoot();
    const blocked = createBasicDeterministicFailureResult("preflight");
    await expect(writeBasicCandidateArtifacts({ repoRoot, candidate: blocked }))
      .rejects.toThrow("basic candidate artifact write failed");

    const authentic = await readyCandidate();
    const forged = Object.freeze({
      ...authentic,
      artifacts: structuredClone(authentic.artifacts),
    });
    await expect(writeBasicCandidateArtifacts({ repoRoot, candidate: forged }))
      .rejects.toThrow("basic candidate artifact write failed");
    const handBuilt = Object.freeze({
      stages: authentic.stages,
      failedStage: authentic.failedStage,
      validation: authentic.validation,
      artifacts: authentic.artifacts,
      boundaryVerdict: authentic.boundaryVerdict,
    });
    await expect(writeBasicCandidateArtifacts({ repoRoot, candidate: handBuilt }))
      .rejects.toThrow("basic candidate artifact write failed");
    const directFactoryResult = createBasicDeterministicSuccessResult(
      authentic.validation!,
      authentic.artifacts!,
    );
    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: directFactoryResult,
    })).rejects.toThrow("basic candidate artifact write failed");
    const directCoreResult = await runBasicDeterministicCandidate(
      createReadyCandidateInput(),
    );
    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: directCoreResult,
    })).rejects.toThrow("basic candidate artifact write failed");
    expect(await pathExists(join(repoRoot, "data", "staging", "example-land", "run-001")))
      .toBe(false);
  });

  test("rejects an existing empty target without claiming it", async () => {
    const repoRoot = await createRepoRoot();
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    await mkdir(target, { recursive: true, mode: 0o700 });

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(await readdir(target)).toEqual([]);
  });

  test("rejects an existing target without changing its content", async () => {
    const repoRoot = await createRepoRoot();
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "owner.txt"), "existing");

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(await readFile(join(target, "owner.txt"), "utf8")).toBe("existing");
  });

  test("rejects symlink staging ancestors and special-file targets", async () => {
    const repoRoot = await createRepoRoot();
    const outside = join(repoRoot, "outside");
    await mkdir(outside);
    await mkdir(join(repoRoot, "data"));
    await symlink(outside, join(repoRoot, "data", "staging"));

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    await rm(join(repoRoot, "data", "staging"));
    await mkdir(join(repoRoot, "data", "staging", "example-land"), { recursive: true });
    await writeFile(
      join(repoRoot, "data", "staging", "example-land", "run-001"),
      "special target",
    );
    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");
  });

  test.each([
    ["data", 0o777],
    ["data/staging", 0o755],
    ["data/staging/example-land", 0o755],
  ] as const)("rejects an unsafe existing %s hierarchy mode", async (relative, mode) => {
    const repoRoot = await createRepoRoot();
    const hierarchy = join(repoRoot, relative);
    await mkdir(hierarchy, { recursive: true, mode });
    await chmod(hierarchy, mode);

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");
    expect(await pathExists(join(repoRoot, "data", "staging", "example-land", "run-001")))
      .toBe(false);
  });

  test("rejects a pre-existing symlink target without following it", async () => {
    const repoRoot = await createRepoRoot();
    const outside = join(repoRoot, "outside");
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    await mkdir(outside);
    await mkdir(join(repoRoot, "data", "staging", "example-land"), {
      recursive: true,
    });
    await symlink(outside, target, "dir");

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(await readdir(outside)).toEqual([]);
  });

  test("retains one private orphan without recursive rm after a partial write", async () => {
    const repoRoot = await createRepoRoot();
    const candidate = await readyCandidate();
    fsFailure.mode = "partial";
    fsFailure.rejectRecursiveRm = true;

    const error = await captureError(() => writeBasicCandidateArtifacts({
      repoRoot,
      candidate,
    }));

    expect(error.message).toBe("basic candidate artifact write failed");
    const parent = join(repoRoot, "data", "staging", "example-land");
    const entries = await readdir(parent);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\.candidate-run-001-.+\.tmp$/);
    expect((await lstat(join(parent, entries[0]!))).mode & 0o777).toBe(0o700);
    expect(await pathExists(join(parent, "run-001"))).toBe(false);
  });

  test("rejects EXDEV without a copy fallback or partial target", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.mode = "exdev";
    const candidate = await readyCandidate();

    const error = await captureError(() => writeBasicCandidateArtifacts({
      repoRoot,
      candidate,
    }));

    expect(error.message).toBe("basic candidate artifact write failed");
    expect(error.message).not.toMatch(/SECRET|cross-device/);
    expect(fsFailure.renameCalls).toBe(0);
    const entries = await readdir(join(repoRoot, "data", "staging", "example-land"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^\.candidate-run-001-.+\.tmp$/);
    expect(await pathExists(join(
      repoRoot,
      "data",
      "staging",
      "example-land",
      "run-001",
    ))).toBe(false);
  });

  test("calls native RENAME_NOREPLACE once only after the complete temp is ready", async () => {
    const repoRoot = await createRepoRoot();

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).resolves.toEqual({ status: "written" });

    expect(nativePublishProbe.calls).toBe(1);
    expect(nativePublishProbe.createCalls).toBe(1);
    expect(nativePublishProbe.ensureCalls).toEqual(["data", "staging", "example-land"]);
    expect(nativePublishProbe.expectedIdentity).not.toBeNull();
    expect(nativePublishProbe.postRenameTargetChecks).toBe(2);
    expect(nativePublishProbe.postRenameArtifactReads).toBe(4);
    expect(nativePublishProbe.postRenameParentSyncs).toBe(1);
  });

  test("fails closed on a hierarchy replacement immediately after native ensure", async () => {
    const repoRoot = await createRepoRoot();
    nativePublishProbe.replaceAfterEnsure = "staging";

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    const replacement = join(repoRoot, "data", "staging");
    expect(nativePublishProbe.ensureCalls).toEqual(["data", "staging", "example-land"]);
    expect(await readFile(join(replacement, "owner.txt"), "utf8")).toBe("foreign");
    expect(await readdir(replacement)).toEqual(["owner.txt"]);
  });

  test("retains a complete published target when post-rename verification fails", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.failPostRenameVerification = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    expect(nativePublishProbe.published).toBe(true);
    expect(await readdir(target)).toHaveLength(4);
    expect((await readdir(join(repoRoot, "data", "staging", "example-land"))))
      .toEqual(["run-001"]);
  });

  test("retains a complete published target when parent fsync fails", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.failPostRenameParentSync = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    expect(nativePublishProbe.postRenameParentSyncs).toBe(1);
    expect(await readdir(target)).toHaveLength(4);
    expect((await readdir(join(repoRoot, "data", "staging", "example-land"))))
      .toEqual(["run-001"]);
  });

  test("never chmods, cleans, or publishes a replacement inserted after native create", async () => {
    const repoRoot = await createRepoRoot();
    nativePublishProbe.replaceAfterCreate = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    const parent = join(repoRoot, "data", "staging", "example-land");
    const entries = await readdir(parent);
    const foreign = entries.find((name) => !name.endsWith(".held"));
    expect(nativePublishProbe.createCalls).toBe(1);
    expect(await readFile(join(parent, foreign!, "owner.txt"), "utf8")).toBe("foreign");
    expect((await lstat(join(parent, foreign!))).mode & 0o777).toBe(0o700);
    expect(await pathExists(join(parent, "run-001"))).toBe(false);
  });

  test("preserves an empty target created immediately before the native syscall", async () => {
    const repoRoot = await createRepoRoot();
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    nativePublishProbe.createTargetBeforeCall = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(nativePublishProbe.calls).toBe(1);
    expect(await readdir(target)).toEqual([]);
  });

  test("fails closed instead of writing through a swapped staging ancestor", async () => {
    const repoRoot = await createRepoRoot();
    const data = join(repoRoot, "data");
    const outside = join(repoRoot, "outside");
    await mkdir(data);
    await mkdir(outside);
    const ancestor = { pathname: data, outside, moved: false };
    fsFailure.ancestor = ancestor;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(ancestor.moved).toBe(true);
    expect(await readdir(outside)).toEqual([]);
  });

  test("uses held descriptor-relative paths for all writer descendants", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.rejectDescendantsOf = repoRoot;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).resolves.toEqual({ status: "written" });
  });

  test.each(["EPERM", "EACCES"] as const)(
    "rejects a %s directory sync failure",
    async (code) => {
      const repoRoot = await createRepoRoot();
      fsFailure.directorySyncError = code;

      await expect(writeBasicCandidateArtifacts({
        repoRoot,
        candidate: await readyCandidate(),
      })).rejects.toThrow("basic candidate artifact write failed");
    },
  );

  test("does not treat a directory-open EPERM as an unsupported sync", async () => {
    const repoRoot = await createRepoRoot();
    const workspace = await openBasicCandidateWorkspace(repoRoot);
    try {
      fsFailure.rejectDirectoryOpen = true;
      await expect(writeBasicCandidateArtifacts({
        workspace,
        candidate: await readyCandidate(),
      })).rejects.toThrow("basic candidate artifact write failed");
    } finally {
      await closeBasicCandidateWorkspace(workspace);
    }
  });

  test("permits only an explicit unsupported directory sync errno", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.directorySyncError = "ENOTSUP";
    fsFailure.directorySyncParentOnly = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).resolves.toEqual({ status: "written" });
  });

  test("allows only one concurrent writer to publish the final target", async () => {
    const repoRoot = await createRepoRoot();
    const candidate = await readyCandidate();

    const settled = await Promise.allSettled([
      writeBasicCandidateArtifacts({ repoRoot, candidate }),
      writeBasicCandidateArtifacts({ repoRoot, candidate }),
    ]);

    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(await readdir(join(
      repoRoot,
      "data",
      "staging",
      "example-land",
      "run-001",
    ))).toHaveLength(4);
  });
});

let cachedCandidate: Awaited<ReturnType<typeof runBasicDeterministicCandidate>> | null = null;

async function readyCandidate() {
  if (cachedCandidate === null) cachedCandidate = await buildReadyCandidate();
  return cachedCandidate;
}

async function buildReadyCandidate() {
  const candidate = await runBasicDeterministicCandidate(createReadyCandidateInput());
  productionCandidates.add(candidate);
  return candidate;
}

function createReadyCandidateInput() {
  const bundle = structuredClone(createBasicCollectionAuditV2Fixture());
  const { sourceRegister, extractedFacts } = bundle;
  const materialization = {
    sourceRegister,
    extractedFacts,
    receipts: [],
  } as unknown as BasicDeterministicMaterializationResultV2;
  return {
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner: { run() { return Promise.resolve(materialization); } },
    sourceChecks: [...bundle.reviewReport.sourceChecks].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId)),
    injectionRisks: [],
  };
}

async function createRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join("/tmp", "basic-candidate-writer-"));
  temporaryRoots.push(repoRoot);
  await mkdir(join(repoRoot, "packages", "db"), { recursive: true });
  await writeFile(join(repoRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await writeFile(join(repoRoot, "package.json"), JSON.stringify({ name: "navigator" }));
  await writeFile(
    join(repoRoot, "packages", "db", "package.json"),
    JSON.stringify({ name: "@navigator/db" }),
  );
  return repoRoot;
}

async function writeBasicCandidateArtifacts(value: Readonly<{
  repoRoot?: string;
  workspace?: BasicCandidateWorkspace;
  candidate: unknown;
}>) {
  if (value.workspace !== undefined) {
    return writeBasicCandidateArtifactsWithWorkspace({
      workspace: value.workspace,
      candidate: value.candidate,
    } as never);
  }
  if (value.repoRoot === undefined) throw new Error("missing test workspace root");
  const workspace = await openBasicCandidateWorkspace(value.repoRoot);
  try {
    return await writeBasicCandidateArtifactsWithWorkspace({
      workspace,
      candidate: value.candidate,
    } as never);
  } finally {
    await closeBasicCandidateWorkspace(workspace);
  }
}

async function pathExists(pathname: string): Promise<boolean> {
  return lstat(pathname).then(() => true, () => false);
}

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected operation to fail");
}

function resetFilesystemProbe(): void {
  nativePublishProbe.calls = 0;
  nativePublishProbe.createCalls = 0;
  nativePublishProbe.ensureCalls = [];
  nativePublishProbe.pendingEnsureName = null;
  nativePublishProbe.ensuredHandles.clear();
  nativePublishProbe.createTargetBeforeCall = false;
  nativePublishProbe.replaceAfterCreate = false;
  nativePublishProbe.replaceAfterEnsure = null;
  nativePublishProbe.published = false;
  nativePublishProbe.expectedIdentity = null;
  nativePublishProbe.postRenameArtifactReads = 0;
  nativePublishProbe.postRenameParentSyncs = 0;
  nativePublishProbe.postRenameTargetChecks = 0;
  fsFailure.mode = "none";
  fsFailure.directorySyncError = null;
  fsFailure.directorySyncParentOnly = false;
  fsFailure.rejectDirectoryOpen = false;
  fsFailure.rejectRecursiveRm = false;
  fsFailure.rejectDescendantsOf = null;
  fsFailure.ancestor = null;
  fsFailure.targetReplacementDone = false;
  fsFailure.failPostRenameVerification = false;
  fsFailure.failPostRenameParentSync = false;
  fsFailure.renameCalls = 0;
}
