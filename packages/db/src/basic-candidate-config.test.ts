import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
  closeBasicCandidateConfig,
  loadBasicCandidateConfig,
  parseBasicCandidateConfig,
  readBasicCandidateCatalog,
  readBasicCandidateConfigInput,
  type LoadedBasicCandidateConfig,
} from "./cli/basic-candidate-config.js";

const filesystemProbe = vi.hoisted(() => ({
  rejectDescendantsOf: null as string | null,
  swapBeforeOpen: null as null | Readonly<{
    before: () => Promise<void>;
    restore: () => Promise<void>;
  }>,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(
      pathname: Parameters<typeof actual.open>[0],
      flags: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) {
      const candidate = String(pathname);
      if (
        filesystemProbe.rejectDescendantsOf !== null &&
        candidate.startsWith(filesystemProbe.rejectDescendantsOf) &&
        candidate !== filesystemProbe.rejectDescendantsOf
      ) {
        throw new Error("SECRET direct descendant open");
      }
      const swap = filesystemProbe.swapBeforeOpen;
      if (swap !== null && candidate.endsWith("/reviews/structured.json")) {
        filesystemProbe.swapBeforeOpen = null;
        await swap.before();
        try {
          return await actual.open(pathname, flags, mode);
        } finally {
          await swap.restore();
        }
      }
      return actual.open(pathname, flags, mode);
    },
  };
});

const temporaryRoots: string[] = [];
const loadedConfigs: LoadedBasicCandidateConfig[] = [];

describe("Basic candidate config", () => {
  afterEach(async () => {
    filesystemProbe.rejectDescendantsOf = null;
    filesystemProbe.swapBeforeOpen = null;
    await Promise.all(loadedConfigs.splice(0).map((loaded) =>
      closeBasicCandidateConfig(loaded)
    ));
    await Promise.all(temporaryRoots.splice(0).map((pathname) =>
      rm(pathname, { recursive: true, force: true })
    ));
  });

  test("parses the exact capability-free config and freezes it", () => {
    const parsed = parseBasicCandidateConfig(validConfig());

    expect(parsed).toEqual(validConfig());
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.sourceIds)).toBe(true);
    expect(Object.isFrozen(parsed.documentPlanPaths)).toBe(true);
  });

  test.each([
    "repoRoot",
    "catalogPath",
    "url",
    "credentials",
    "outputPath",
    "model",
    "bridge",
    "prompt",
    "hermes",
    "search",
  ])("rejects forbidden config capability %s", (key) => {
    expect(() => parseBasicCandidateConfig({
      ...validConfig(),
      [key]: "https://secret.invalid/?token=SECRET",
    })).toThrow("basic candidate config is invalid");
  });

  test.each([
    ["wrong schema", { schemaVersion: "basic-country-candidate-config/v2" }],
    ["lowercase ISO2", { countryCode: "id" }],
    ["unsafe country directory", { countryDirectory: "../indonesia" }],
    ["unsafe run ID", { runId: "run/id" }],
    ["unsorted sources", { sourceIds: ["source-b", "source-a"] }],
    ["duplicate sources", { sourceIds: ["source-a", "source-a"] }],
    ["absolute input", { structuredReviewPath: "/tmp/review.json" }],
    ["win32 slash absolute input", { editorialInputPath: "C:/tmp/editorial.json" }],
    ["drive-qualified input", { editorialInputPath: "C:editorial.json" }],
    ["win32 rooted input", { editorialInputPath: "\\\\editorial.json" }],
    ["UNC input", { editorialInputPath: "\\\\server\\share\\editorial.json" }],
    ["slash UNC input", { editorialInputPath: "//server/share/editorial.json" }],
    ["parent input", { manualReviewPath: "reviews/../manual.json" }],
    ["dot input", { editorialInputPath: "./editorial.json" }],
    ["NUL input", { editorialInputPath: "editorial.json\0outside" }],
    ["backslash input", { editorialInputPath: "reviews\\editorial.json" }],
    ["unsorted plans", {
      documentPlanPaths: ["plans/source-b.json", "plans/source-a.json"],
    }],
    ["duplicate plans", {
      documentPlanPaths: ["plans/source-a.json", "plans/source-a.json"],
    }],
    ["cross-role duplicate", {
      manualReviewPath: "reviews/structured.json",
    }],
  ] as const)("rejects %s", (_name, override) => {
    expect(() => parseBasicCandidateConfig({
      ...validConfig(),
      ...override,
    })).toThrow("basic candidate config is invalid");
  });

  test("loads only the exact run config and reads registered child inputs", async () => {
    const fixture = await createRunFixture();
    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );

    expect(loaded.config).toEqual(validConfig());
    await expect(readBasicCandidateConfigInput(
      loaded,
      "reviews/structured.json",
    )).resolves.toEqual({ kind: "structured" });
    await expect(readBasicCandidateConfigInput(
      loaded,
      "unregistered.json",
    )).rejects.toThrow("basic candidate input is invalid");
  });

  test("opens config, input, and catalog descendants through held descriptors", async () => {
    const fixture = await createRunFixture();
    const catalogDirectory = join(fixture.repoRoot, "packages", "db", "catalog");
    await mkdir(catalogDirectory, { recursive: true });
    await writeFile(
      join(catalogDirectory, "basic-source-catalog.json"),
      JSON.stringify({ schemaVersion: "catalog" }),
      { mode: 0o600 },
    );
    filesystemProbe.rejectDescendantsOf = fixture.repoRoot;

    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );

    await expect(readBasicCandidateConfigInput(loaded, "reviews/structured.json"))
      .resolves.toEqual({ kind: "structured" });
    await expect(readBasicCandidateCatalog(fixture.repoRoot)).resolves.toEqual({
      schemaVersion: "catalog",
    });
  });

  test("rejects a repository root reached through a symlinked ancestor", async () => {
    const fixture = await createRunFixture();
    const container = await mkdtemp(join(tmpdir(), "basic-candidate-root-"));
    temporaryRoots.push(container);
    const realParent = join(container, "real");
    const realRoot = join(realParent, "repo");
    await mkdir(realParent);
    await rename(fixture.repoRoot, realRoot);
    const linkedParent = join(container, "linked");
    await symlink(realParent, linkedParent, "dir");

    let accepted: LoadedBasicCandidateConfig | null = null;
    try {
      accepted = await loadBasicCandidateConfig(
        join(linkedParent, "repo"),
        ".cache/basic-country/ID/run-1/candidate-config.json",
      );
    } catch {
      // The stable public error is asserted by every other invalid-load case.
    } finally {
      if (accepted !== null) await closeBasicCandidateConfig(accepted);
    }

    expect(accepted).toBeNull();
  });

  test("keeps a config input confined when its named ancestor is swapped and restored", async () => {
    const fixture = await createRunFixture();
    const reviewDirectory = join(fixture.runDirectory, "reviews");
    const displaced = join(fixture.runDirectory, "reviews-displaced");
    const outside = join(fixture.repoRoot, "outside-reviews");
    await mkdir(outside);
    await writeFile(
      join(outside, "structured.json"),
      JSON.stringify({ kind: "outside" }),
      { mode: 0o600 },
    );
    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );
    filesystemProbe.swapBeforeOpen = Object.freeze({
      async before() {
        await rename(reviewDirectory, displaced);
        await symlink(outside, reviewDirectory, "dir");
      },
      async restore() {
        await rm(reviewDirectory);
        await rename(displaced, reviewDirectory);
      },
    });

    await expect(readBasicCandidateConfigInput(loaded, "reviews/structured.json"))
      .resolves.toEqual({ kind: "structured" });
  });

  test.each([
    "/tmp/candidate-config.json",
    ".cache/basic-country/ID/run-1/other.json",
    ".cache/basic-country/ID/run-1/../run-1/candidate-config.json",
    ".cache/basic-country/id/run-1/candidate-config.json",
  ])("rejects invalid config location %s", async (configPath) => {
    const fixture = await createRunFixture();

    await expect(loadBasicCandidateConfig(fixture.repoRoot, configPath))
      .rejects.toThrow("basic candidate config is invalid");
  });

  test("binds config identity to the path country and run", async () => {
    const fixture = await createRunFixture({ runId: "different-run" });

    await expect(loadBasicCandidateConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    )).rejects.toThrow("basic candidate config is invalid");
  });

  test("rejects symlink ancestors and symlink input targets", async () => {
    const fixture = await createRunFixture();
    const outside = join(fixture.repoRoot, "outside.json");
    await writeFile(outside, "{}", { mode: 0o600 });
    await rm(join(fixture.runDirectory, "reviews", "structured.json"));
    await symlink(outside, join(fixture.runDirectory, "reviews", "structured.json"));
    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );

    await expect(readBasicCandidateConfigInput(
      loaded,
      "reviews/structured.json",
    )).rejects.toThrow("basic candidate input is invalid");

    await rm(join(fixture.runDirectory, "reviews"), { recursive: true });
    await mkdir(join(fixture.repoRoot, "outside-reviews"));
    await symlink(
      join(fixture.repoRoot, "outside-reviews"),
      join(fixture.runDirectory, "reviews"),
    );
    await expect(readBasicCandidateConfigInput(
      loaded,
      "reviews/manual.json",
    )).rejects.toThrow("basic candidate input is invalid");
  });

  test("rejects special files and oversized files without leaking filesystem text", async () => {
    const fixture = await createRunFixture();
    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );
    await rm(join(fixture.runDirectory, "reviews", "structured.json"));
    await mkdir(join(fixture.runDirectory, "reviews", "structured.json"));
    const directoryError = await captureError(() => readBasicCandidateConfigInput(
      loaded,
      "reviews/structured.json",
    ));
    expect(directoryError.message).toBe("basic candidate input is invalid");
    expect(directoryError.message).not.toContain(fixture.repoRoot);

    await rm(join(fixture.runDirectory, "editorial.json"));
    await writeFile(
      join(fixture.runDirectory, "editorial.json"),
      Buffer.alloc(2 * 1024 * 1024 + 1),
      { mode: 0o600 },
    );
    await expect(readBasicCandidateConfigInput(loaded, "editorial.json"))
      .rejects.toThrow("basic candidate input is invalid");
  });

  test("reads only the fixed catalog child and rejects a symlink catalog", async () => {
    const fixture = await createRunFixture();
    const catalogDirectory = join(fixture.repoRoot, "packages", "db", "catalog");
    await mkdir(catalogDirectory, { recursive: true });
    const catalogPath = join(catalogDirectory, "basic-source-catalog.json");
    await writeFile(catalogPath, JSON.stringify({ schemaVersion: "catalog" }), {
      mode: 0o600,
    });

    await expect(readBasicCandidateCatalog(fixture.repoRoot)).resolves.toEqual({
      schemaVersion: "catalog",
    });

    await rm(catalogPath);
    await symlink(join(fixture.repoRoot, "outside.json"), catalogPath);
    await expect(readBasicCandidateCatalog(fixture.repoRoot))
      .rejects.toThrow("basic candidate catalog is invalid");
  });

  test("keeps config and input files read-only", async () => {
    const fixture = await createRunFixture();
    await chmod(join(fixture.runDirectory, "editorial.json"), 0o400);
    const before = await readFile(join(fixture.runDirectory, "editorial.json"));
    const loaded = await loadConfig(
      fixture.repoRoot,
      ".cache/basic-country/ID/run-1/candidate-config.json",
    );

    await readBasicCandidateConfigInput(loaded, "editorial.json");

    expect(await readFile(join(fixture.runDirectory, "editorial.json"))).toEqual(before);
    expect(constants.O_NOFOLLOW).toBeTypeOf("number");
  });
});

function validConfig(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: BASIC_COUNTRY_CANDIDATE_CONFIG_SCHEMA_VERSION,
    countryDirectory: "indonesia",
    countryCode: "ID",
    runId: "run-1",
    sourceIds: ["source-a", "source-b"],
    structuredReviewPath: "reviews/structured.json",
    manualReviewPath: "reviews/manual.json",
    documentPlanPaths: ["plans/source-b.json"],
    editorialInputPath: "editorial.json",
    ...overrides,
  };
}

async function createRunFixture(overrides: Record<string, unknown> = {}) {
  const repoRoot = await mkdtemp(join(tmpdir(), "basic-candidate-config-"));
  temporaryRoots.push(repoRoot);
  const runDirectory = join(repoRoot, ".cache", "basic-country", "ID", "run-1");
  await mkdir(join(runDirectory, "reviews"), { recursive: true });
  await mkdir(join(runDirectory, "plans"));
  await writeFile(
    join(runDirectory, "candidate-config.json"),
    JSON.stringify(validConfig(overrides)),
    { mode: 0o600 },
  );
  await writeFile(
    join(runDirectory, "reviews", "structured.json"),
    JSON.stringify({ kind: "structured" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(runDirectory, "reviews", "manual.json"),
    JSON.stringify({ kind: "manual" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(runDirectory, "plans", "source-b.json"),
    JSON.stringify({ kind: "document" }),
    { mode: 0o600 },
  );
  await writeFile(
    join(runDirectory, "editorial.json"),
    JSON.stringify({ kind: "editorial" }),
    { mode: 0o600 },
  );
  await writeFile(join(repoRoot, "outside.json"), "{}", { mode: 0o600 });
  return { repoRoot, runDirectory };
}

async function loadConfig(
  repoRoot: string,
  configPath: string,
): Promise<LoadedBasicCandidateConfig> {
  const loaded = await loadBasicCandidateConfig(repoRoot, configPath);
  loadedConfigs.push(loaded);
  return loaded;
}

async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error("expected operation to fail");
}
