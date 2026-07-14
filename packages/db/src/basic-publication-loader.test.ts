import {
  appendFileSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { afterEach, describe, expect, test, vi } from "vitest";

const readerProbe = vi.hoisted(() => ({
  afterRead: null as (() => void) | null,
  requests: [] as unknown[],
}));

const fsProbe = vi.hoisted(() => ({
  beforeLstatPathname: null as string | null,
  fileByDescriptor: new Map<number, string>(),
  matchedLstats: 0,
  matchedReads: 0,
  onBeforeLstat: null as (() => void) | null,
  onMatchedRead: null as (() => void) | null,
  pathname: null as string | null,
  readCalls: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    lstatSync(...args: Parameters<typeof actual.lstatSync>) {
      const pathname: unknown = args[0];
      if (
        pathname === fsProbe.beforeLstatPathname &&
        fsProbe.onBeforeLstat !== null
      ) {
        fsProbe.matchedLstats += 1;
        const hook = fsProbe.onBeforeLstat;
        fsProbe.onBeforeLstat = null;
        hook();
      }
      return Reflect.apply(actual.lstatSync, undefined, args) as ReturnType<
        typeof actual.lstatSync
      >;
    },
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
import { sha256Hex } from "./collection/basic-publication-digests.js";
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
const DUPLICATE_MEMBER_KINDS = [
  "top-level",
  "nested",
  "escaped-equivalent",
] as const;

type PhaseTwoKey = typeof PHASE_TWO_KEYS[number];

afterEach(() => {
  readerProbe.afterRead = null;
  readerProbe.requests.length = 0;
  fsProbe.beforeLstatPathname = null;
  fsProbe.fileByDescriptor.clear();
  fsProbe.matchedLstats = 0;
  fsProbe.matchedReads = 0;
  fsProbe.onBeforeLstat = null;
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

  test.each(PHASE_TWO_KEYS.flatMap((key) =>
    DUPLICATE_MEMBER_KINDS.map((kind) => [key, kind] as const)))(
    "fails closed on %s repository bytes with %s duplicate members",
    (key, kind) => {
      const fixture = writePublicationRepository();
      writeRepositoryDuplicate(fixture, key, kind);

      const result = loadPublication(fixture);
      const exposed = JSON.stringify(result);

      expect(result).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
      expect(exposed).not.toContain(fixture.root);
      expect(exposed).not.toMatch(/duplicate|schemaVersion|nested|position/i);
    },
  );

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

  test.each(["root", "canonical", "staging", "approval"] as const)(
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

  test.each(PHASE_TWO_KEYS)(
    "rejects a direct-file symlink for phase-two target %s with exact allowlists",
    (key) => {
      const fixture = writePublicationRepository();
      const displaced = join(fixture.root, `displaced-${safeFilename(key)}.json`);
      replaceFileWithSymlink(fixture.paths[key], displaced);

      expectExactDirectoryEntries(fixture);
      const result = loadPublication(fixture);
      const exposed = JSON.stringify(result);
      expect(result).toEqual(publicationFailure("PUBLICATION_READ_FAILED"));
      expect(exposed).not.toMatch(/symlink|ELOOP|displaced-|basic-publication-loader/);
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
    "rejects early phase-two same-name replacement of %s before its file baseline",
    (key) => {
      const fixture = writePublicationRepository();
      const pathname = fixture.paths[key];
      const replacement = join(fixture.root, `replacement-${safeFilename(key)}`);
      writeFileSync(replacement, readFileSync(pathname));
      readerProbe.afterRead = () => armLstatMutation(
        pathname,
        () => renameSync(replacement, pathname),
      );

      expect(loadPublication(fixture)).toEqual(
        publicationFailure("PUBLICATION_READ_FAILED"),
      );
      expect(readerProbe.requests).toHaveLength(2);
      expect(fsProbe.matchedLstats).toBe(1);
    },
  );

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
    const sharedSchema = resolve(fileURLToPath(new URL(
      "../../../packages/shared-types/src/schema.ts",
      import.meta.url,
    )));
    expect(closure.has(sharedSchema)).toBe(true);
    const violations: string[] = [];
    const nodeModules = new Set<string>();
    let nodeFsOwnerCount = 0;
    let nodeUtilTypesOwnerCount = 0;
    for (const [pathname, source] of closure) {
      const sourceFile = parseTypeScript(pathname, source);
      const specifiers = staticProductionDependencies(sourceFile);
      violations.push(...productionCapabilityViolations(sourceFile, specifiers));
      for (const specifier of specifiers) {
        if (specifier.startsWith("node:")) nodeModules.add(specifier);
      }
      if (specifiers.includes("node:fs")) {
        nodeFsOwnerCount += 1;
        expect(basename(pathname)).toBe("basic-stable-json-file-set.ts");
        expect(nodeModuleImports(sourceFile, "node:fs")).toEqual([
          "BigIntStats",
          "closeSync",
          "constants",
          "fstatSync",
          "lstatSync",
          "openSync",
          "readSync",
          "readdirSync",
        ]);
        expect(openSyncFlagSets(sourceFile)).toEqual([[
          "O_NOFOLLOW",
          "O_NONBLOCK",
          "O_RDONLY",
        ]]);
      }
      if (specifiers.includes("node:util/types")) {
        nodeUtilTypesOwnerCount += 1;
        expect(nodeModuleImports(sourceFile, "node:util/types")).toEqual([
          "isProxy",
        ]);
      }
    }
    expect([...nodeModules].sort()).toEqual([
      "node:crypto",
      "node:fs",
      "node:path",
      "node:util/types",
    ]);
    expect(nodeFsOwnerCount).toBe(1);
    expect(nodeUtilTypesOwnerCount).toBe(4);
    expect(violations).toEqual([]);
  });

  test.each([
    ["fetch alias", 'const send = fetch; send("https://example.test");'],
    ["eval alias", 'const execute = eval; execute("1 + 1");'],
    ["Function alias", "const Constructor = Function; void Constructor;"],
    ["globalThis process route", "void globalThis.process;"],
    ["globalThis clock route", "globalThis.Date.now();"],
    ["global element route", 'void global["process"];'],
    ["WebSocket construction", 'new WebSocket("wss://example.test");'],
    ["XMLHttpRequest alias", "const Request = XMLHttpRequest; void Request;"],
    ["EventSource alias", "const Events = EventSource; void Events;"],
    ["timeout alias", "const later = setTimeout; void later;"],
    ["interval alias", "const repeat = setInterval; void repeat;"],
    ["createRequire alias", "const requireFactory = createRequire; void requireFactory;"],
    ["createRequire module", 'import { createRequire } from "node:module";'],
    ["vm module", 'import type { Context } from "vm"; type Probe = Context;'],
    ["inspector module", 'import "node:inspector";'],
    ["async hooks module", 'export { executionAsyncId } from "async_hooks";'],
    ["network module", 'import type { Agent } from "node:http"; type Probe = Agent;'],
    ["filesystem stream alias", "const writer = createWriteStream; void writer;"],
    ["process environment alias", "const runtime = process; void runtime.env;"],
    ["performance alias", "const clock = performance; void clock.now();"],
    ["aliased performance module", 'import { performance as clock } from "node:perf_hooks"; clock.now();'],
    ["aliased timer module", 'import { setTimeout as sleep } from "node:timers/promises"; sleep(1);'],
    ["aliased HTTP/2 module", 'import { connect as dial } from "node:http2"; dial("https://example.test");'],
    ["unknown external runtime package", 'import { execute } from "runtime-package-not-approved"; execute();'],
    ["hrtime alias", "const clock = hrtime; void clock;"],
    ["Date alias", "const Clock = Date; void Clock.now();"],
  ])("rejects a %s capability reference or module", (_case, source) => {
    const sourceFile = parseTypeScript("capability-probe.ts", source);
    const specifiers = staticProductionDependencies(sourceFile);

    expect(productionCapabilityViolations(sourceFile, specifiers)).not.toEqual([]);
  });

  test("allows direct Date.parse without matching capability words in comments or strings", () => {
    const sourceFile = parseTypeScript("lexical-probe.ts", `
      // fetch process writeFile must remain lexical text only.
      const words = "fetch process writeFile globalThis WebSocket";
      const parsed = Date.parse("2026-07-14T00:00:00Z");
      void words;
      void parsed;
    `);

    expect(productionCapabilityViolations(
      sourceFile,
      staticProductionDependencies(sourceFile),
    )).toEqual([]);
  });

  test("production dependency parsing includes normal, type, side-effect, and export-from edges", () => {
    const sourceFile = parseTypeScript("dependency-probe.ts", `
      import { value } from "./normal.js";
      import type { Shape } from "./type.js";
      import "./side-effect.js";
      export { forwarded } from "./exported.js";
      void value;
      type Probe = Shape;
    `);

    expect(staticProductionDependencies(sourceFile)).toEqual([
      "./normal.js",
      "./type.js",
      "./side-effect.js",
      "./exported.js",
    ]);
  });

  test.each([
    ["dynamic import", 'void import("./dynamic.js");'],
    ["require call", 'require("./required.js");'],
  ])("production dependency parsing rejects a %s edge", (_case, source) => {
    const sourceFile = parseTypeScript("dependency-probe.ts", source);

    expect(() => staticProductionDependencies(sourceFile)).toThrowError(
      /^Dynamic import and require calls are forbidden in production closure$/,
    );
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

function writeRepositoryDuplicate(
  fixture: RepositoryFixture,
  key: PhaseTwoKey,
  kind: typeof DUPLICATE_MEMBER_KINDS[number],
): void {
  const duplicateBytes = withDuplicateJsonMembers(
    readFileSync(fixture.paths[key]),
    kind,
  );
  writeFileSync(fixture.paths[key], duplicateBytes);
  if (key === "manifest" || key === "country" || key === "marketOverview") {
    return;
  }
  if (key === "approvalReceipt") {
    writeManifest(fixture, {
      ...fixture.publication.manifest,
      approvalReceiptSha256: sha256Hex(duplicateBytes),
    });
    return;
  }

  const receipt = structuredClone(fixture.publication.approvalReceipt);
  const receiptBytes = new TextEncoder().encode(`${JSON.stringify({
    ...receipt,
    artifactSha256: {
      ...receipt.artifactSha256,
      [key]: sha256Hex(duplicateBytes),
    },
  })}\n`);
  writeFileSync(fixture.paths.approvalReceipt, receiptBytes);
  writeManifest(fixture, {
    ...fixture.publication.manifest,
    approvalReceiptSha256: sha256Hex(receiptBytes),
  });
}

function withDuplicateJsonMembers(
  bytes: Uint8Array,
  kind: typeof DUPLICATE_MEMBER_KINDS[number],
): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const key = Object.keys(parsed)[0];
  if (key === undefined) throw new Error("fixture JSON object is empty");
  const memberName = kind === "escaped-equivalent"
    ? escapedEquivalentMemberName(key)
    : JSON.stringify(key);
  const memberValue = kind === "nested"
    ? '{"nested":1,"nested":2}'
    : JSON.stringify(parsed[key]);
  if (memberValue === undefined) throw new Error("fixture JSON member is invalid");
  return new TextEncoder().encode(
    text.replace(/^\s*\{/u, (opening) =>
      `${opening}${memberName}:${memberValue},`),
  );
}

function escapedEquivalentMemberName(key: string): string {
  const first = key.codePointAt(0);
  if (first === undefined || first > 0x7f) {
    throw new Error("fixture JSON key must start with ASCII");
  }
  return `"\\u${first.toString(16).padStart(4, "0")}${key.slice(1)}"`;
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

function replaceFileWithSymlink(pathname: string, displaced: string): void {
  renameSync(pathname, displaced);
  symlinkSync(displaced, pathname, "file");
}

function expectExactDirectoryEntries(fixture: RepositoryFixture): void {
  expect(readdirSync(fixture.canonicalDirectory).sort()).toEqual(
    [...CANONICAL_NAMES].sort(),
  );
  expect(readdirSync(fixture.candidateDirectory).sort()).toEqual(
    [...CANDIDATE_NAMES].sort(),
  );
}

function armLstatMutation(pathname: string, mutate: () => void): void {
  fsProbe.beforeLstatPathname = pathname;
  fsProbe.onBeforeLstat = mutate;
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
  const workspaceRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const closure = new Map<string, string>();
  const pending = [entry];
  while (pending.length > 0) {
    const pathname = pending.pop();
    if (pathname === undefined || closure.has(pathname)) continue;
    const source = readFileSync(pathname, "utf8");
    closure.set(pathname, source);
    const sourceFile = parseTypeScript(pathname, source);
    for (const specifier of staticProductionDependencies(sourceFile)) {
      const dependency = resolveProductionDependency(
        specifier,
        pathname,
        workspaceRoot,
      );
      if (dependency !== null) pending.push(dependency);
    }
  }
  return closure;
}

function parseTypeScript(pathname: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    pathname,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
}

function staticProductionDependencies(sourceFile: ts.SourceFile): readonly string[] {
  const specifiers: string[] = [];
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      specifiers.push(literalModuleSpecifier(statement.moduleSpecifier));
    } else if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier !== undefined
    ) {
      specifiers.push(literalModuleSpecifier(statement.moduleSpecifier));
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference) &&
      statement.moduleReference.expression !== undefined
    ) {
      specifiers.push(literalModuleSpecifier(
        statement.moduleReference.expression,
      ));
    }
  }
  visitNodes(sourceFile, (node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        isRequireCallee(node.expression))
    ) {
      throw new Error(
        "Dynamic import and require calls are forbidden in production closure",
      );
    }
  });
  return Object.freeze(specifiers);
}

function literalModuleSpecifier(expression: ts.Expression): string {
  if (!ts.isStringLiteralLike(expression)) {
    throw new Error("Production module specifiers must be string literals");
  }
  return expression.text;
}

function isRequireCallee(expression: ts.Expression): boolean {
  return ts.isIdentifier(expression) && expression.text === "require" ||
    ts.isPropertyAccessExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === "require";
}

function resolveProductionDependency(
  specifier: string,
  containingFile: string,
  workspaceRoot: string,
): string | null {
  if (APPROVED_PRODUCTION_NODE_MODULES.has(specifier)) return null;
  if (!isProductionSourceSpecifier(specifier)) {
    throw new Error(`Production dependency is not allowlisted: ${specifier}`);
  }
  const result = ts.resolveModuleName(
    specifier,
    containingFile,
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2022,
    },
    ts.sys,
  ).resolvedModule;
  if (result === undefined) {
    throw new Error(`Production dependency could not be resolved: ${specifier}`);
  }
  const resolvedFile = ts.sys.realpath?.(result.resolvedFileName) ??
    result.resolvedFileName;
  const dependency = resolve(resolvedFile);
  const workspaceRelative = relative(workspaceRoot, dependency);
  const isWorkspaceDependency = workspaceRelative !== "" &&
    workspaceRelative !== ".." &&
    !workspaceRelative.startsWith(`..${sep}`) &&
    !isAbsolute(workspaceRelative) &&
    !workspaceRelative.split(sep).includes("node_modules");
  if (!isWorkspaceDependency || !dependency.endsWith(".ts")) {
    throw new Error(`Production source dependency escaped workspace: ${specifier}`);
  }
  return dependency;
}

const APPROVED_PRODUCTION_NODE_MODULES = new Set([
  "node:crypto",
  "node:fs",
  "node:path",
  "node:util/types",
]);

function isProductionSourceSpecifier(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("@navigator/");
}

const DANGEROUS_RUNTIME_IDENTIFIERS = new Map<string, string>([
  ["EventSource", "network API: EventSource"],
  ["Function", "runtime code execution: Function"],
  ["WebSocket", "network API: WebSocket"],
  ["XMLHttpRequest", "network API: XMLHttpRequest"],
  ["createRequire", "runtime module loading: createRequire"],
  ["eval", "runtime code execution: eval"],
  ["fetch", "network API: fetch"],
  ["global", "global capability API: global"],
  ["globalThis", "global capability API: globalThis"],
  ["hrtime", "clock API: hrtime"],
  ["performance", "clock API: performance"],
  ["process", "environment/process API"],
  ["setInterval", "timer API: setInterval"],
  ["setTimeout", "timer API: setTimeout"],
]);

const FILESYSTEM_WRITE_APIS = new Set([
  "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync",
  "copyFile", "copyFileSync", "cp", "cpSync", "createWriteStream", "fchmod",
  "fchmodSync", "fchown", "fchownSync", "ftruncate", "ftruncateSync", "futimes",
  "futimesSync", "lchown", "lchownSync", "link", "linkSync", "lutimes",
  "lutimesSync", "mkdir", "mkdirSync", "mkdtemp", "mkdtempSync", "rename",
  "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "symlink", "symlinkSync",
  "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync",
  "write", "writeFile", "writeFileSync", "writeSync",
]);

function productionCapabilityViolations(
  sourceFile: ts.SourceFile,
  specifiers: readonly string[],
): readonly string[] {
  const violations = new Set<string>();
  for (const specifier of specifiers) {
    if (
      !isProductionSourceSpecifier(specifier) &&
      !APPROVED_PRODUCTION_NODE_MODULES.has(specifier)
    ) violations.add(`forbidden module: ${specifier}`);
    if (
      specifier === "node:fs" &&
      basename(sourceFile.fileName) !== "basic-stable-json-file-set.ts"
    ) violations.add(`node:fs outside stable reader: ${sourceFile.fileName}`);
  }

  visitNodes(sourceFile, (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const name = calledExpressionName(node.expression);
      if (name !== null && FILESYSTEM_WRITE_APIS.has(name)) {
        violations.add(`filesystem write API: ${name}`);
      }
      if (name === "fetch") violations.add("network API: fetch");
      if (name === "eval" || name === "Function") {
        violations.add(`runtime code execution: ${name}`);
      }
      if (name === "Date") violations.add("clock API: Date");
    }
    if (ts.isIdentifier(node) && isRuntimeIdentifierReference(node)) {
      const dangerousCapability = DANGEROUS_RUNTIME_IDENTIFIERS.get(node.text);
      if (dangerousCapability !== undefined) {
        violations.add(dangerousCapability);
      }
      if (FILESYSTEM_WRITE_APIS.has(node.text)) {
        violations.add(`filesystem write API: ${node.text}`);
      }
      if (
        node.text === "Date" &&
        !isAllowedDateParseReference(node)
      ) violations.add("clock API: Date");
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "hrtime"
    ) violations.add("clock API: hrtime");
  });
  return [...violations].sort();
}

function nodeModuleImports(
  sourceFile: ts.SourceFile,
  moduleSpecifier: string,
): readonly string[] {
  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      literalModuleSpecifier(statement.moduleSpecifier) !== moduleSpecifier
    ) continue;
    const clause = statement.importClause;
    if (clause?.name !== undefined) names.push(`default:${clause.name.text}`);
    if (clause?.namedBindings !== undefined) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        names.push(`namespace:${clause.namedBindings.name.text}`);
      } else {
        for (const element of clause.namedBindings.elements) {
          const imported = element.propertyName?.text ?? element.name.text;
          names.push(imported === element.name.text
            ? imported
            : `${imported} as ${element.name.text}`);
        }
      }
    }
  }
  return names.sort();
}

function openSyncFlagSets(sourceFile: ts.SourceFile): readonly (readonly string[])[] {
  const flagSets: string[][] = [];
  let invalidReference = false;
  visitNodes(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || node.text !== "openSync") return;
    if (ts.isImportSpecifier(node.parent)) return;
    if (
      !ts.isCallExpression(node.parent) ||
      node.parent.expression !== node ||
      node.parent.arguments[1] === undefined
    ) {
      invalidReference = true;
      return;
    }
    const flags = bitwiseConstantFlags(node.parent.arguments[1]);
    if (flags === null) invalidReference = true;
    else flagSets.push(flags.sort());
  });
  if (invalidReference) {
    throw new Error("openSync must be called directly with static read-only flags");
  }
  return flagSets;
}

function bitwiseConstantFlags(expression: ts.Expression): string[] | null {
  if (ts.isParenthesizedExpression(expression)) {
    return bitwiseConstantFlags(expression.expression);
  }
  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.BarToken
  ) {
    const left = bitwiseConstantFlags(expression.left);
    const right = bitwiseConstantFlags(expression.right);
    return left === null || right === null ? null : [...left, ...right];
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "constants" &&
    /^O_[A-Z]+$/u.test(expression.name.text)
  ) return [expression.name.text];
  return null;
}

function calledExpressionName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression !== undefined &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) return expression.argumentExpression.text;
  return null;
}

function isRuntimeIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isBindingElement(parent) && parent.name === node ||
    ts.isVariableDeclaration(parent) && parent.name === node ||
    ts.isParameter(parent) && parent.name === node ||
    ts.isFunctionDeclaration(parent) && parent.name === node ||
    ts.isPropertyAccessExpression(parent) && parent.name === node ||
    ts.isPropertyAssignment(parent) && parent.name === node
  ) return false;
  return true;
}

function isAllowedDateParseReference(node: ts.Identifier): boolean {
  return ts.isPropertyAccessExpression(node.parent) &&
    node.parent.expression === node &&
    node.parent.name.text === "parse" &&
    ts.isCallExpression(node.parent.parent) &&
    node.parent.parent.expression === node.parent;
}

function visitNodes(root: ts.Node, visit: (node: ts.Node) => void): void {
  const walk = (node: ts.Node): void => {
    visit(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}
