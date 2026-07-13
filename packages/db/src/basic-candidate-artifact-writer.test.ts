import {
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

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import { createBasicDeterministicFailureResult } from "./collection/basic-deterministic-candidate-result.js";
import {
  writeBasicCandidateArtifacts,
} from "./cli/basic-candidate-artifact-writer.js";

const fsFailure = vi.hoisted(() => ({
  mode: "none" as
    | "none"
    | "partial"
    | "exdev"
    | "target-nonempty-replacement"
    | "target-empty-replacement",
  directorySyncError: null as null | "EACCES" | "EPERM" | "ENOTSUP",
  rejectDirectoryOpen: false,
  rejectRecursiveRm: false,
  rejectDescendantsOf: null as string | null,
  ancestor: null as null | {
    pathname: string;
    outside: string;
    moved: boolean;
  },
  targetReplacementDone: false,
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
      const close = handle.close.bind(handle);
      fsFailure.openHandles.add(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: async () => {
          try {
            await close();
          } finally {
            fsFailure.openHandles.delete(handle);
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
      if (isDirectory && directorySyncError !== null) {
        Object.defineProperty(handle, "sync", {
          configurable: true,
          value: async () => {
            const error = new Error("SECRET directory sync failure") as NodeJS.ErrnoException;
            error.code = directorySyncError;
            throw error;
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
    expect(fsFailure.renameCalls).toBe(1);
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

  test("cleans fixed owned entries without recursive rm after a partial write", async () => {
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
    expect(await readdir(parent)).toEqual([]);
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
    expect(fsFailure.renameCalls).toBe(1);
    expect(await readdir(join(repoRoot, "data", "staging", "example-land"))).toEqual([]);
  });

  test("rejects a nonempty concurrent replacement after reserving the target name", async () => {
    const repoRoot = await createRepoRoot();
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    fsFailure.mode = "target-nonempty-replacement";

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(await readFile(join(target, "owner.txt"), "utf8")).toBe("attacker");
    expect(await readdir(target)).toEqual(["owner.txt"]);
  });

  test("rejects an empty concurrent replacement after holding the target identity", async () => {
    const repoRoot = await createRepoRoot();
    const target = join(repoRoot, "data", "staging", "example-land", "run-001");
    fsFailure.mode = "target-empty-replacement";

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

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
    fsFailure.rejectDirectoryOpen = true;

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");
  });

  test("permits only an explicit unsupported directory sync errno", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.directorySyncError = "ENOTSUP";

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).resolves.toEqual({ status: "written" });
  });

  test("allows only one concurrent writer to reserve the final target", async () => {
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
  const bundle = structuredClone(createBasicCollectionAuditFixture());
  const sourceRegister = {
    ...bundle.sourceRegister,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
    catalogVersion: "catalog-v1",
    catalogSha256: "a".repeat(64),
  };
  const extractedFacts = {
    ...bundle.extractedFacts,
    schemaVersion: BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  };
  for (const fact of extractedFacts.facts) {
    const owner = classifyBasicV2FieldPath(fact.fieldPath);
    fact.extractionMethod = owner === "source-backed" || owner === "derived"
      ? "deterministic"
      : "manual";
  }
  extractedFacts.facts.sort((left, right) => left.fieldPath.localeCompare(right.fieldPath));
  const materialization = {
    sourceRegister,
    extractedFacts,
    receipts: [],
  } as unknown as BasicDeterministicMaterializationResultV2;
  return runBasicDeterministicCandidate({
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner: { run() { return Promise.resolve(materialization); } },
    sourceChecks: bundle.reviewReport.sourceChecks.sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId)),
    injectionRisks: [],
  });
}

async function createRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(join("/tmp", "basic-candidate-writer-"));
  temporaryRoots.push(repoRoot);
  return repoRoot;
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
  fsFailure.mode = "none";
  fsFailure.directorySyncError = null;
  fsFailure.rejectDirectoryOpen = false;
  fsFailure.rejectRecursiveRm = false;
  fsFailure.rejectDescendantsOf = null;
  fsFailure.ancestor = null;
  fsFailure.targetReplacementDone = false;
  fsFailure.renameCalls = 0;
}
