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
  mode: "none" as "none" | "partial" | "exdev" | "tamper",
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(pathname: Parameters<typeof actual.open>[0], flags: Parameters<typeof actual.open>[1], mode?: number) {
      if (
        fsFailure.mode === "partial" && flags === "wx" &&
        String(pathname).endsWith("extracted-facts.json")
      ) throw new Error("SECRET partial write failure");
      return actual.open(pathname, flags, mode);
    },
    async rename(oldPath: Parameters<typeof actual.rename>[0], newPath: Parameters<typeof actual.rename>[1]) {
      if (fsFailure.mode === "exdev") {
        const error = new Error("SECRET cross-device path") as NodeJS.ErrnoException;
        error.code = "EXDEV";
        throw error;
      }
      if (fsFailure.mode === "tamper") {
        await actual.writeFile(join(String(oldPath), "source-register.json"), "tampered");
      }
      return actual.rename(oldPath, newPath);
    },
  };
});

const temporaryRoots: string[] = [];

describe("Basic candidate atomic artifact writer", () => {
  beforeEach(() => {
    fsFailure.mode = "none";
  });

  afterEach(async () => {
    fsFailure.mode = "none";
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
    expect(await pathExists(join(repoRoot, "data", "staging", "example-land", "run-001")))
      .toBe(false);
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

  test("cleans only its owned temporary directory after a partial write", async () => {
    const repoRoot = await createRepoRoot();
    const candidate = await readyCandidate();
    fsFailure.mode = "partial";

    const error = await captureError(() => writeBasicCandidateArtifacts({
      repoRoot,
      candidate,
    }));

    expect(error.message).toBe("basic candidate artifact write failed");
    const parent = join(repoRoot, "data", "staging", "example-land");
    expect(await readdir(parent)).toEqual([]);
  });

  test("rejects tampering and removes the moved owned identity", async () => {
    const repoRoot = await createRepoRoot();
    fsFailure.mode = "tamper";

    await expect(writeBasicCandidateArtifacts({
      repoRoot,
      candidate: await readyCandidate(),
    })).rejects.toThrow("basic candidate artifact write failed");

    expect(await readdir(join(repoRoot, "data", "staging", "example-land"))).toEqual([]);
  });

  test("rejects EXDEV without a copy fallback or partial target", async () => {
    const repoRoot = await createRepoRoot();
    const candidate = await readyCandidate();
    fsFailure.mode = "exdev";

    const error = await captureError(() => writeBasicCandidateArtifacts({
      repoRoot,
      candidate,
    }));

    expect(error.message).toBe("basic candidate artifact write failed");
    expect(error.message).not.toMatch(/SECRET|cross-device/);
    expect(await readdir(join(repoRoot, "data", "staging", "example-land"))).toEqual([]);
  });

  test("allows only one concurrent writer for the same stable temp identity", async () => {
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
