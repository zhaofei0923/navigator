import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

const readerProbe = vi.hoisted(() => ({
  afterRead: null as (() => void) | null,
  requests: [] as unknown[],
}));

const fsProbe = vi.hoisted(() => ({
  fileByDescriptor: new Map<number, string>(),
  matchedReads: 0,
  onMatchedRead: null as (() => void) | null,
  pathname: null as string | null,
  readCalls: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(...args: Parameters<typeof actual.openSync>) {
      const descriptor = Reflect.apply(actual.openSync, undefined, args) as number;
      const pathname: unknown = args[0];
      if (typeof pathname === "string") {
        fsProbe.fileByDescriptor.set(descriptor, pathname);
      }
      return descriptor;
    },
    readSync(...args: Parameters<typeof actual.readSync>) {
      const result = Reflect.apply(actual.readSync, undefined, args) as number;
      fsProbe.readCalls += 1;
      const descriptor: unknown = args[0];
      if (
        typeof descriptor === "number" &&
        fsProbe.pathname === fsProbe.fileByDescriptor.get(descriptor) &&
        fsProbe.onMatchedRead !== null
      ) {
        fsProbe.matchedReads += 1;
        const hook = fsProbe.onMatchedRead;
        fsProbe.onMatchedRead = null;
        hook();
      }
      return result;
    },
    closeSync(...args: Parameters<typeof actual.closeSync>) {
      const descriptor = args[0];
      try {
        return Reflect.apply(actual.closeSync, undefined, args) as void;
      } finally {
        fsProbe.fileByDescriptor.delete(descriptor);
      }
    },
  };
});

vi.mock("./collection/basic-stable-json-file-set.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("./collection/basic-stable-json-file-set.js")
  >();
  return {
    ...actual,
    readBasicStableJsonFileSet(
      request: Parameters<typeof actual.readBasicStableJsonFileSet>[0],
    ) {
      readerProbe.requests.push(structuredClone(request));
      const result = actual.readBasicStableJsonFileSet(request);
      const hook = readerProbe.afterRead;
      readerProbe.afterRead = null;
      hook?.();
      return result;
    },
  };
});

import { createBasicCollectionAuditFixture } from "./basic-collection-test-fixture.js";
import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import type { BasicCollectionAuditArtifactName } from "./collection/basic-offline-audit-artifacts.js";
import type { BasicCountryPublicationManifestV2 } from "./collection/basic-publication-contracts.js";
import { BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES } from "./collection/basic-publication-contracts.js";
import { loadApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-loader.js";
import { validateApprovedBasicCountryPublicationV2 } from "./collection/basic-publication-validator.js";

const roots = new Set<string>();
const CANDIDATE_NAMES = [
  "source-register.json",
  "extracted-facts.json",
  "market-overview.draft.json",
  "review-report.json",
] as const satisfies readonly BasicCollectionAuditArtifactName[];
const CANONICAL_NAMES = [
  "collection-manifest.json",
  "country.json",
  "market-overview.json",
] as const;
const PHASE_TWO_KEYS = [
  "manifest",
  "country",
  "marketOverview",
  "approvalReceipt",
  ...CANDIDATE_NAMES,
] as const;

type PhaseTwoKey = typeof PHASE_TWO_KEYS[number];

afterEach(() => {
  readerProbe.afterRead = null;
  readerProbe.requests.length = 0;
  fsProbe.fileByDescriptor.clear();
  fsProbe.matchedReads = 0;
  fsProbe.onMatchedRead = null;
  fsProbe.pathname = null;
  fsProbe.readCalls = 0;
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("approved Basic publication repository loader", () => {
  test("matches the in-memory validator through one manifest read and one eight-file snapshot", () => {
    const fixture = writePublicationRepository();

    const result = loadApprovedBasicCountryPublicationV2(
      fixture.root,
      fixture.countryDirectory,
    );

    expect(result).toEqual(validateApprovedBasicCountryPublicationV2(
      fixture.publication.validationInput,
    ));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(readerProbe.requests).toHaveLength(2);
    expectRequestShape(fixture);
  });

  test.each([
    ["relative", "relative/repository"],
    ["unnormalized", null],
    ["trailing separator", null],
    ["NUL-containing", null],
  ])("rejects a %s repository root before I/O", (kind, fixedRoot) => {
    const fixture = writePublicationRepository();
    const repoRoot = fixedRoot ?? (kind === "unnormalized"
      ? `${fixture.root}/data/..`
      : kind === "trailing separator"
        ? `${fixture.root}/`
        : `${fixture.root}\0`);

    expect(loadApprovedBasicCountryPublicationV2(
      repoRoot,
      fixture.countryDirectory,
    )).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
    expect(readerProbe.requests).toHaveLength(0);
    expect(fsProbe.readCalls).toBe(0);
  });

  test.each(["", ".", "../country", "Example-Land", "example_land", "example/land"])(
    "rejects unsafe country slug %j before I/O",
    (countryDirectory) => {
      const fixture = writePublicationRepository();

      expect(loadApprovedBasicCountryPublicationV2(
        fixture.root,
        countryDirectory,
      )).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
      expect(readerProbe.requests).toHaveLength(0);
      expect(fsProbe.readCalls).toBe(0);
    },
  );

  test.each(["repository root", "country slug"] as const)(
    "contains a non-string runtime %s failure before I/O",
    (kind) => {
      const fixture = writePublicationRepository();
      const invalid = undefined as unknown as string;

      expect(loadApprovedBasicCountryPublicationV2(
        kind === "repository root" ? invalid : fixture.root,
        kind === "country slug" ? invalid : fixture.countryDirectory,
      )).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
      expect(readerProbe.requests).toHaveLength(0);
      expect(fsProbe.readCalls).toBe(0);
    },
  );

  test.each([
    ["missing", (fixture: RepositoryFixture) => rmSync(fixture.paths.manifest)],
    ["malformed", (fixture: RepositoryFixture) => writeFileSync(fixture.paths.manifest, "{", "utf8")],
    ["oversized", (fixture: RepositoryFixture) => writeFileSync(
      fixture.paths.manifest,
      Buffer.alloc(BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES + 1, 0x20),
    )],
  ])("returns a read failure for a %s manifest", (_case, mutate) => {
    const fixture = writePublicationRepository();
    mutate(fixture);

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
  });

  test("returns MANIFEST_INVALID only for a structurally read invalid manifest", () => {
    const fixture = writePublicationRepository();
    writeJson(fixture.paths.manifest, {
      ...fixture.publication.manifest,
      unexpected: true,
    });

    const result = loadPublication(fixture);

    expect(result).toEqual(publicationFailure("MANIFEST_INVALID"));
    expect(Object.isFrozen(result)).toBe(true);
    expect(readerProbe.requests).toHaveLength(1);
  });

  test.each([
    ["audit bundle", { auditBundlePath: "data/staging/example-land/run-002" }],
    ["approval receipt", { approvalReceiptPath: "data/approvals/example-land/run-002.json" }],
  ])("rejects a literal %s path mismatch before phase two", (_case, patch) => {
    const fixture = writePublicationRepository();
    writeManifest(fixture, { ...fixture.publication.manifest, ...patch });

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_IDENTITY_MISMATCH"),
    );
    expect(readerProbe.requests).toHaveLength(1);
  });

  test("rejects a valid v1 candidate at the v2 publication gate", () => {
    const fixture = writePublicationRepository();
    const legacy = createBasicCollectionAuditFixture();
    writeJson(fixture.paths["source-register.json"], legacy.sourceRegister);
    writeJson(fixture.paths["extracted-facts.json"], legacy.extractedFacts);
    writeJson(fixture.paths["market-overview.draft.json"], legacy.marketOverviewDraft);
    writeJson(fixture.paths["review-report.json"], legacy.reviewReport);

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
    expect(readerProbe.requests).toHaveLength(2);
  });

  test.each([
    ["approval receipt", "approvalReceipt" as const],
    ["candidate artifact", "source-register.json" as const],
  ])("detects %s byte drift", (_case, key) => {
    const fixture = writePublicationRepository();
    appendFileSync(fixture.paths[key], "\n", "utf8");

    expect(loadPublication(fixture)).toEqual(publicationFailure(
      key === "approvalReceipt"
        ? "APPROVAL_RECEIPT_HASH_MISMATCH"
        : "CANDIDATE_ARTIFACT_HASH_MISMATCH",
    ));
  });

  test("rejects an extra canonical artifact during phase one", () => {
    const fixture = writePublicationRepository();
    writeJson(join(fixture.canonicalDirectory, "unexpected.json"), {});

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
    expect(readerProbe.requests).toHaveLength(1);
  });

  test("rejects a fifth candidate artifact during phase two", () => {
    const fixture = writePublicationRepository();
    writeJson(join(fixture.candidateDirectory, "unexpected.json"), {});

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
    expect(readerProbe.requests).toHaveLength(2);
  });

  test.each(["root", "canonical", "staging", "approval", "file"] as const)(
    "rejects a symlinked %s path without leaking its target",
    (kind) => {
      const fixture = writePublicationRepository();
      let repoRoot = fixture.root;
      if (kind === "root") {
        const container = createRoot("basic-publication-link-");
        repoRoot = join(container, "repo-link");
        symlinkSync(fixture.root, repoRoot, "dir");
      } else if (kind === "canonical") {
        replaceDirectoryWithSymlink(fixture.canonicalDirectory);
      } else if (kind === "staging") {
        replaceDirectoryWithSymlink(join(fixture.root, "data", "staging"));
      } else if (kind === "approval") {
        replaceDirectoryWithSymlink(join(fixture.root, "data", "approvals"));
      } else {
        replaceFileWithSymlink(fixture.paths["source-register.json"]);
      }

      const result = loadApprovedBasicCountryPublicationV2(
        repoRoot,
        fixture.countryDirectory,
      );
      const exposed = JSON.stringify(result);
      expect(result).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
      expect(exposed).not.toMatch(/symlink|ELOOP|\.real|basic-publication-link/);
    },
  );

  test("rejects a special-file target before opening it", () => {
    const fixture = writePublicationRepository();
    rmSync(fixture.paths.approvalReceipt);
    mkdirSync(fixture.paths.approvalReceipt);

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
  });

  test("rejects phase-one manifest replacement before phase two even when both values are valid", () => {
    const fixture = writePublicationRepository();
    readerProbe.afterRead = () => {
      writeFileSync(
        fixture.paths.manifest,
        ` ${JSON.stringify(fixture.publication.manifest)}\n`,
        "utf8",
      );
    };

    expect(loadPublication(fixture)).toEqual(
      publicationFailure("PUBLICATION_READ_FAILED"),
    );
    expect(readerProbe.requests).toHaveLength(2);
    expect(Object.keys(requestAt(1).files)).toHaveLength(8);
  });

  test.each(PHASE_TWO_KEYS)(
    "rejects phase-two replacement of %s while its held descriptor is read",
    (key) => {
      const fixture = writePublicationRepository();
      const pathname = fixture.paths[key];
      const replacement = join(fixture.root, `replacement-${safeFilename(key)}`);
      writeFileSync(replacement, readFileSync(pathname));
      readerProbe.afterRead = () => armReadMutation(
        pathname,
        () => renameSync(replacement, pathname),
      );

      expect(loadPublication(fixture)).toEqual(
        publicationFailure("PUBLICATION_READ_FAILED"),
      );
      expect(readerProbe.requests).toHaveLength(2);
      expect(fsProbe.matchedReads).toBe(1);
    },
  );

  test.each(["canonical", "candidate"] as const)(
    "rejects %s directory entries changed during the phase-two snapshot",
    (kind) => {
      const fixture = writePublicationRepository();
      const directory = kind === "canonical"
        ? fixture.canonicalDirectory
        : fixture.candidateDirectory;
      const trigger = kind === "canonical"
        ? fixture.paths.country
        : fixture.paths["source-register.json"];
      readerProbe.afterRead = () => armReadMutation(trigger, () => {
        writeJson(join(directory, "unexpected.json"), {});
      });

      expect(loadPublication(fixture)).toEqual(
        publicationFailure("PUBLICATION_READ_FAILED"),
      );
      expect(readerProbe.requests).toHaveLength(2);
      expect(fsProbe.matchedReads).toBe(1);
    },
  );

  test("redacts absolute paths, source values, URL queries, and parser details", () => {
    const fixture = writePublicationRepository();
    const sourceRegister = {
      ...structuredClone(fixture.publication.candidate.sourceRegister),
    };
    Object.assign(sourceRegister, {
      rawSourceValue: "source-secret-value",
      sourceUrl: "https://example.test/data?token=query-secret",
    });
    writeJson(fixture.paths["source-register.json"], sourceRegister);

    const result = loadPublication(fixture);
    const exposed = JSON.stringify(result);

    expect(result).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
    expect(exposed).not.toContain(fixture.root);
    expect(exposed).not.toMatch(/source-secret-value|query-secret|example\.test|Unexpected token/);
  });

  test("redacts filesystem errors and target names", () => {
    const fixture = writePublicationRepository();
    rmSync(fixture.paths.marketOverview);

    const result = loadPublication(fixture);
    const exposed = JSON.stringify(result);

    expect(result).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
    expect(exposed).not.toContain(fixture.root);
    expect(exposed).not.toMatch(/ENOENT|market-overview\.json|no such file/);
  });

  test("has no write, network, environment, process, or Prisma capability in its production dependency closure", () => {
    const entry = fileURLToPath(new URL(
      "./collection/basic-publication-loader.ts",
      import.meta.url,
    ));
    const closure = readProductionDependencyClosure(entry);
    const forbidden = [
      /@prisma\/client/u,
      /(?:node:)?child_process/u,
      /\bfetch\s*\(/u,
      /\b(?:writeFile|appendFile|rename|unlink|rm|mkdir)(?:Sync)?\s*\(/u,
      /process\.env/u,
    ];

    for (const [pathname, source] of closure) {
      for (const pattern of forbidden) expect(source, pathname).not.toMatch(pattern);
      if (source.includes('from "node:fs"')) {
        expect(basename(pathname)).toBe("basic-stable-json-file-set.ts");
        expect(nodeFsImports(source)).toEqual([
          "BigIntStats",
          "closeSync",
          "constants",
          "fstatSync",
          "lstatSync",
          "openSync",
          "readSync",
          "readdirSync",
        ]);
      }
    }
  });
});

interface RepositoryFixture {
  readonly root: string;
  readonly countryDirectory: string;
  readonly canonicalDirectory: string;
  readonly candidateDirectory: string;
  readonly publication: ReturnType<typeof createBasicCountryPublicationFixture>;
  readonly paths: Readonly<Record<PhaseTwoKey, string>>;
}

function writePublicationRepository(): RepositoryFixture {
  const publication = createBasicCountryPublicationFixture();
  const root = createRoot("basic-publication-loader-");
  const countryDirectory = publication.approvalReceipt.countryDirectory;
  const runId = publication.approvalReceipt.runId;
  const canonicalDirectory = join(root, "data", countryDirectory);
  const candidateDirectory = join(root, "data", "staging", countryDirectory, runId);
  const approvalDirectory = join(root, "data", "approvals", countryDirectory);
  mkdirSync(canonicalDirectory, { recursive: true });
  mkdirSync(candidateDirectory, { recursive: true });
  mkdirSync(approvalDirectory, { recursive: true });

  const paths: Record<PhaseTwoKey, string> = {
    manifest: join(canonicalDirectory, "collection-manifest.json"),
    country: join(canonicalDirectory, "country.json"),
    marketOverview: join(canonicalDirectory, "market-overview.json"),
    approvalReceipt: join(approvalDirectory, `${runId}.json`),
    "source-register.json": join(candidateDirectory, "source-register.json"),
    "extracted-facts.json": join(candidateDirectory, "extracted-facts.json"),
    "market-overview.draft.json": join(candidateDirectory, "market-overview.draft.json"),
    "review-report.json": join(candidateDirectory, "review-report.json"),
  };
  writeJson(paths.manifest, publication.manifest);
  writeJson(paths.country, publication.canonical.country);
  writeJson(paths.marketOverview, publication.canonical.marketOverview);
  writeFileSync(paths.approvalReceipt, publication.approvalReceiptBytes);
  for (const name of CANDIDATE_NAMES) {
    writeFileSync(paths[name], publication.candidateArtifactBytes[name]);
  }
  return {
    root,
    countryDirectory,
    canonicalDirectory,
    candidateDirectory,
    publication,
    paths: Object.freeze(paths),
  };
}

function loadPublication(fixture: RepositoryFixture) {
  return loadApprovedBasicCountryPublicationV2(
    fixture.root,
    fixture.countryDirectory,
  );
}

function writeManifest(
  fixture: RepositoryFixture,
  manifest: BasicCountryPublicationManifestV2,
): void {
  writeJson(fixture.paths.manifest, manifest);
}

function writeJson(pathname: string, value: unknown): void {
  writeFileSync(pathname, `${JSON.stringify(value)}\n`, "utf8");
}

function createRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.add(root);
  return root;
}

function replaceDirectoryWithSymlink(pathname: string): void {
  const displaced = `${pathname}.real`;
  renameSync(pathname, displaced);
  symlinkSync(displaced, pathname, "dir");
}

function replaceFileWithSymlink(pathname: string): void {
  const displaced = `${pathname}.real`;
  renameSync(pathname, displaced);
  symlinkSync(displaced, pathname, "file");
}

function armReadMutation(pathname: string, mutate: () => void): void {
  fsProbe.pathname = pathname;
  fsProbe.onMatchedRead = mutate;
}

function safeFilename(value: string): string {
  return value.replaceAll(".", "-");
}

function publicationFailure(blockerCode: string) {
  return { valid: false, blockerCode, data: null };
}

function requestAt(index: number): StableReaderRequestSnapshot {
  const value = readerProbe.requests[index];
  if (typeof value !== "object" || value === null) {
    throw new Error("stable reader request was not captured");
  }
  return value as StableReaderRequestSnapshot;
}

interface StableReaderRequestSnapshot {
  readonly files: Readonly<Record<string, string>>;
  readonly exactDirectories: readonly Readonly<{
    pathname: string;
    entries: readonly string[];
  }>[];
  readonly maximumBytes: number;
}

function expectRequestShape(fixture: RepositoryFixture): void {
  const first = requestAt(0);
  expect(first.files).toEqual({ manifest: fixture.paths.manifest });
  expect(first.exactDirectories).toEqual([{
    pathname: fixture.canonicalDirectory,
    entries: CANONICAL_NAMES,
  }]);
  expect(first.maximumBytes).toBe(BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES);

  const second = requestAt(1);
  expect(Object.values(second.files).sort()).toEqual(
    Object.values(fixture.paths).sort(),
  );
  expect(second.exactDirectories).toEqual([
    { pathname: fixture.canonicalDirectory, entries: CANONICAL_NAMES },
    { pathname: fixture.candidateDirectory, entries: CANDIDATE_NAMES },
  ]);
  expect(second.maximumBytes).toBe(BASIC_COUNTRY_PUBLICATION_JSON_MAX_BYTES);
}

function readProductionDependencyClosure(entry: string): Map<string, string> {
  const closure = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const pathname = pending.pop();
    if (pathname === undefined || closure.has(pathname)) continue;
    const source = readFileSync(pathname, "utf8");
    closure.set(pathname, source);
    for (const specifier of relativeImports(source)) {
      const dependency = resolve(dirname(pathname), specifier.replace(/\.js$/u, ".ts"));
      pending.push(dependency);
    }
  }
  return closure;
}

function relativeImports(source: string): readonly string[] {
  return [...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/gu)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

function nodeFsImports(source: string): readonly string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /import(?:\s+type)?\s*\{([^}]+)\}\s*from\s*"node:fs"/gu,
  )) {
    const block = match[1];
    if (block === undefined) continue;
    names.push(...block.split(",").map((name) => name.trim()).filter(Boolean));
  }
  return names.sort();
}
