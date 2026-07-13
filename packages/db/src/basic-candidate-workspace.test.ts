import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";
import { vi } from "vitest";

const productionCandidates = vi.hoisted(() => new WeakSet<object>());

vi.mock("./cli/basic-candidate-composition.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./cli/basic-candidate-composition.js")>();
  return {
    ...actual,
    isBasicCandidateProductionResult(value: unknown) {
      return typeof value === "object" && value !== null && productionCandidates.has(value);
    },
  };
});

import { createBasicCollectionAuditV2Fixture } from "./basic-collection-test-fixture.js";
import {
  BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION,
  classifyBasicV2FieldPath,
  type BasicDeterministicMaterializationResultV2,
} from "./collection/basic-collection-v2-contracts.js";
import { writeBasicCandidateArtifacts } from "./cli/basic-candidate-artifact-writer.js";
import { composeBasicCountryCandidate } from "./cli/basic-candidate-composition.js";
import { runBasicDeterministicCandidate } from "./collection/basic-deterministic-candidate.js";
import {
  BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
  loadBasicCandidateConfig,
  readBasicCandidateCatalog,
  readBasicCandidateConfigInput,
} from "./cli/basic-candidate-config.js";

import {
  closeBasicCandidateWorkspace,
  getBasicCandidateWorkspaceDescriptorRoot,
  openBasicCandidateWorkspace,
} from "./cli/basic-candidate-workspace.js";

const temporaryRoots: string[] = [];

describe("Basic candidate workspace capability", () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((pathname) =>
      rm(pathname, { recursive: true, force: true })
    ));
  });

  test("binds one opaque capability to the opened root inode across a named-root swap", async () => {
    const root = await createWorkspace("original");
    const displaced = `${root}.displaced`;
    const workspace = await openBasicCandidateWorkspace(root);
    const descriptorRoot = getBasicCandidateWorkspaceDescriptorRoot(workspace);

    await rename(root, displaced);
    await createWorkspaceAt(root, "replacement");

    expect(Object.isFrozen(workspace)).toBe(true);
    expect(Reflect.ownKeys(workspace)).toEqual([]);
    expect(descriptorRoot).toMatch(/^\/proc\/self\/fd\/\d+\/$/);
    expect(await readFile(join(descriptorRoot, "workspace-marker.txt"), "utf8"))
      .toBe("original");
    expect(await readFile(join(root, "workspace-marker.txt"), "utf8"))
      .toBe("replacement");

    await closeBasicCandidateWorkspace(workspace);
  });

  test("rejects forged and closed capabilities and closes the held descriptor once", async () => {
    const root = await createWorkspace("original");
    const workspace = await openBasicCandidateWorkspace(root);
    const descriptorRoot = getBasicCandidateWorkspaceDescriptorRoot(workspace);

    expect(() => getBasicCandidateWorkspaceDescriptorRoot(Object.freeze({})))
      .toThrow("basic candidate workspace is invalid");

    await closeBasicCandidateWorkspace(workspace);
    await expect(closeBasicCandidateWorkspace(workspace)).resolves.toBeUndefined();
    expect(() => getBasicCandidateWorkspaceDescriptorRoot(workspace))
      .toThrow("basic candidate workspace is invalid");
    await expect(readFile(join(descriptorRoot, "workspace-marker.txt"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  test("keeps config, catalog, runner cache, and writer on one held root across swaps", async () => {
    const root = await createIntegratedWorkspace();
    const heldRoot = `${root}.held-original`;
    const workspace = await openBasicCandidateWorkspace(root);
    let generation = 0;
    const swapNamedRoot = async (marker: string) => {
      const displaced = generation === 0
        ? heldRoot
        : `${root}.replacement-${generation}`;
      temporaryRoots.push(displaced);
      await rename(root, displaced);
      await createWorkspaceAt(root, marker);
      generation += 1;
    };
    const candidate = await createReadyCandidate();
    const plan = Object.freeze({
      catalogVersion: "catalog-v1",
      catalogSha256: "a".repeat(64),
      countryCode: "ID",
      sources: Object.freeze([
        Object.freeze({ source: Object.freeze({
          sourceId: "source-a",
          adapterKind: "deterministic",
        }) }),
      ]),
    });
    try {
      const composition = await composeBasicCountryCandidate({
        workspace,
        configPath: ".cache/basic-country/ID/run-001/candidate-config.json",
        transport: Object.freeze({ execute() { throw new Error("unused"); } }) as never,
      }, {
        async loadConfig(capability, path) {
          const loaded = await loadBasicCandidateConfig(capability, path);
          await swapNamedRoot("replacement-after-config");
          return loaded;
        },
        async readCatalog(capability) {
          const catalog = await readBasicCandidateCatalog(capability);
          await swapNamedRoot("replacement-after-catalog");
          return catalog;
        },
        parseCatalog() {
          return { catalog: {}, catalogSha256: "a".repeat(64) } as never;
        },
        createPlan() { return plan as never; },
        async runPlan(input) {
          expect(input.repoRoot).toMatch(/^\/proc\/self\/fd\/\d+\/$/);
          await writeFile(
            join(input.repoRoot, ".cache/basic-country/ID/run-001/runner-proof.txt"),
            "held-runner",
          );
          await swapNamedRoot("replacement-after-runner");
          return { documentCaptures: [] } as never;
        },
        readConfigInput: readBasicCandidateConfigInput,
        parseStructuredReview() { return {} as never; },
        parseManualReview() { throw new Error("unused"); },
        parseDocumentPlan() { throw new Error("unused"); },
        materializeDocument() { throw new Error("unused"); },
        parseEditorial() { return {} as never; },
        materializeReviewed() {
          return {
            materialization: {},
            sourceChecks: [],
            injectionRisks: [],
          } as never;
        },
        async runCandidate() { return candidate; },
        getWorkspaceDescriptorRoot: getBasicCandidateWorkspaceDescriptorRoot,
      });
      expect(composition.status).toBe("ready");
      await swapNamedRoot("replacement-before-writer");
      await writeBasicCandidateArtifacts({ workspace, candidate });

      expect(await readFile(join(
        heldRoot,
        ".cache/basic-country/ID/run-001/runner-proof.txt",
      ), "utf8")).toBe("held-runner");
      expect(await readFile(join(
        heldRoot,
        "data/staging/example-land/run-001/source-register.json",
      ), "utf8")).toContain(BASIC_COLLECTION_AUDIT_V2_SCHEMA_VERSION);
      await expect(lstat(join(root, "data"))).rejects.toMatchObject({ code: "ENOENT" });
      expect(await readFile(join(root, "workspace-marker.txt"), "utf8"))
        .toBe("replacement-before-writer");
    } finally {
      await closeBasicCandidateWorkspace(workspace);
    }
  });
});

async function createWorkspace(marker: string): Promise<string> {
  const root = await mkdtemp("/tmp/basic-candidate-workspace-");
  temporaryRoots.push(root, `${root}.displaced`);
  await createWorkspaceAt(root, marker);
  return root;
}

async function createWorkspaceAt(root: string, marker: string): Promise<void> {
  await mkdir(join(root, "packages", "db"), { recursive: true });
  await writeFile(join(root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  await writeFile(join(root, "package.json"), JSON.stringify({ name: "navigator" }));
  await writeFile(
    join(root, "packages", "db", "package.json"),
    JSON.stringify({ name: "@navigator/db" }),
  );
  await writeFile(join(root, "workspace-marker.txt"), marker);
}

async function createIntegratedWorkspace(): Promise<string> {
  const root = await createWorkspace("original");
  const run = join(root, ".cache/basic-country/ID/run-001");
  await mkdir(join(run, "reviews"), { recursive: true });
  await mkdir(join(root, "packages/db/catalog"), { recursive: true });
  await writeFile(join(run, "candidate-config.json"), JSON.stringify({
    schemaVersion: BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
    countryDirectory: "example-land",
    countryCode: "ID",
    runId: "run-001",
    sourceIds: ["source-a"],
    structuredReviewPath: "reviews/structured.json",
    manualReviewPath: null,
    documentPlanPaths: [],
    editorialInputPath: "editorial.json",
  }));
  await writeFile(join(run, "reviews/structured.json"), JSON.stringify({ held: true }));
  await writeFile(join(run, "editorial.json"), JSON.stringify({ held: true }));
  await writeFile(
    join(root, "packages/db/catalog/basic-source-catalog.json"),
    JSON.stringify({ held: true }),
  );
  return root;
}

async function createReadyCandidate() {
  const bundle = structuredClone(createBasicCollectionAuditV2Fixture());
  const { sourceRegister, extractedFacts } = bundle;
  const materialization = {
    sourceRegister,
    extractedFacts,
    receipts: [],
  } as unknown as BasicDeterministicMaterializationResultV2;
  const candidate = await runBasicDeterministicCandidate({
    countryDirectory: bundle.countryDirectory,
    countryCode: sourceRegister.countryCode,
    runId: sourceRegister.runId,
    catalogVersion: sourceRegister.catalogVersion,
    catalogSha256: sourceRegister.catalogSha256,
    runner: { run() { return Promise.resolve(materialization); } },
    sourceChecks: [...bundle.reviewReport.sourceChecks].sort((left, right) =>
      left.sourceId.localeCompare(right.sourceId)),
    injectionRisks: [],
  });
  productionCandidates.add(candidate);
  return candidate;
}
