import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type { BasicCollectionJsonValue } from "./collection/basic-collection-contracts.js";
import {
  BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  parseBasicCountryCandidateInput,
  type BasicCountryCandidateConfig,
  type BasicCountryCandidateRuntime,
} from "./collection/basic-country-candidate-contracts.js";
import {
  classifyBasicCountryCandidateArgs,
  runBasicCountryCandidateCli,
} from "./collection/basic-country-candidate-cli.js";
import { runBasicCountryCandidate } from "./collection/basic-country-candidate-runner.js";
import { loadBasicCollectionAuditBundle } from "./collection/basic-collection-loader.js";
import type { BasicLlamaCppFetch } from "./collection/basic-hermes-llama-contracts.js";
import type { BasicSourceFetch } from "./collection/basic-source-transport.js";

const SENTINEL = "SECRET_token_provider-path_raw-value";
const RUN_ID = "data-basic-id-20260711-r1";
const COUNTRY = "ID";
const DIRECTORY = "indonesia";
const SOURCE_URL = "https://data.example.test/indonesia.json?format=json";
const DISCOVERY_QUERY = "Indonesia official JSON data";
const NOW = "2026-07-11T00:00:00.000Z";

const DRAFT = {
  overview: { zh: "印度尼西亚市场概览", en: "Indonesia market overview" },
  population: 280_000_000,
  gdp: 1_400_000_000_000,
  gdpGrowth: 5.1,
  energyDemand: { zh: "需求持续增长", en: "Demand continues to grow" },
  renewableTarget: { zh: "提高可再生能源占比", en: "Increase the renewable share" },
  keyIndicators: [{
    label: { zh: "可再生能源目标", en: "Renewable target" },
    value: "23",
    unit: "%",
    year: 2025,
  }],
  source: "Official Indonesia JSON",
  sourceUrl: SOURCE_URL,
  collectedAt: NOW,
  updatedAt: NOW,
  credibility: "OFFICIAL",
  reviewStatus: "draft",
  aiUsable: false,
  countryCode: COUNTRY,
  industryTags: ["solar"],
  techTags: ["pv-module"],
} as const;

const OPENED_VALUES: readonly BasicCollectionJsonValue[] = [
  { zh: "印度尼西亚是东南亚大型能源市场。", en: "Indonesia is a large Southeast Asian energy market." },
  "southeast-asia",
  "ID",
  NOW,
  DRAFT.overview,
  DRAFT.energyDemand,
  DRAFT.renewableTarget,
  DRAFT.source,
  DRAFT.sourceUrl,
  DRAFT.collectedAt,
  DRAFT.updatedAt,
  DRAFT.credibility,
  DRAFT.countryCode,
  [...DRAFT.industryTags],
  [...DRAFT.techTags],
  DRAFT.keyIndicators[0].label,
  DRAFT.keyIndicators[0].value,
  DRAFT.keyIndicators[0].unit,
  DRAFT.keyIndicators[0].year,
];

const OPENED_PATHS = [
  "country.summary",
  "country.region",
  "country.flagEmoji",
  "country.updatedAt",
  "marketOverview.overview",
  "marketOverview.energyDemand",
  "marketOverview.renewableTarget",
  "marketOverview.source",
  "marketOverview.sourceUrl",
  "marketOverview.collectedAt",
  "marketOverview.updatedAt",
  "marketOverview.credibility",
  "marketOverview.countryCode",
  "marketOverview.industryTags",
  "marketOverview.techTags",
  "marketOverview.keyIndicators[0].label",
  "marketOverview.keyIndicators[0].value",
  "marketOverview.keyIndicators[0].unit",
  "marketOverview.keyIndicators[0].year",
] as const;

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) {
    await import("node:fs/promises").then(({ rm }) => rm(root, { recursive: true, force: true }));
  }
});

describe("Basic country candidate runner", () => {
  test("runs deterministic capture, discovery validation, JSON promotion, preflight, llama, P1-6D, write, and loader round-trip in order", async () => {
    const value = await createCase();

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toEqual({
      ok: true,
      code: "READY_FOR_HUMAN_REVIEW",
      summary: {
        countryCode: COUNTRY,
        runId: RUN_ID,
        sourceCount: 5,
        factCount: 24,
        readyForHumanReview: true,
      },
      artifacts: BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
    });
    expect(value.events).toEqual([
      "source:world-bank-country",
      "source:world-bank-gdp",
      "source:world-bank-gdp-growth",
      "source:world-bank-population",
      "source:official-source",
      "llama",
    ]);
    const bundle = loadBasicCollectionAuditBundle(value.outputRoot, DIRECTORY, RUN_ID);
    expect(bundle.reviewReport).toMatchObject({
      status: "ready-for-human-review",
      publicationRecommendation: "request-human-review",
      humanDecision: null,
    });
    expect((await readdir(value.artifactRoot)).sort()).toEqual([...BASIC_COUNTRY_CANDIDATE_ARTIFACTS].sort());
  });

  test.each([
    "country.code",
    "country.name",
    "marketOverview.population",
    "marketOverview.gdp",
    "marketOverview.gdpGrowth",
  ])("rejects deterministic overlap %s before capture or write", async (fieldPath) => {
    const value = await createCase();
    value.config.openedSources[0]!.observations[0]!.fieldPath = fieldPath;

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test("requires the final deterministic plus promoted union to cover every required path", async () => {
    const value = await createCase();
    value.config.openedSources[0]!.observations.pop();

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
    expect(value.events).not.toContain("llama");
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test.each([
    ["missing discovery id", (value: Awaited<ReturnType<typeof createCase>>) => {
      value.config.openedSources[0]!.discoveryId = "missing-source";
    }],
    ["source URL mismatch", (value: Awaited<ReturnType<typeof createCase>>) => {
      const url = "https://data.example.test/other.json?format=json";
      value.config.openedSources[0]!.policy.sourceUrl = url;
      observation(value.config, "marketOverview.sourceUrl").normalizedValue = url;
    }],
    ["unused discovery candidate", (value: Awaited<ReturnType<typeof createCase>>) => {
      value.discoveryResponse.candidates.push({
        ...value.discoveryResponse.candidates[0]!,
        discoveryId: "unused-source",
        url: "https://data.example.test/unused.json?format=json",
      });
    }],
  ] as const)("authorizes every opened plan before capture: %s", async (_label, mutate) => {
    const value = await createCase();
    mutate(value);

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "EVIDENCE_REJECTED", artifacts: null });
    expect(value.events).not.toContain("source:official-source");
    const rawRoot = join(value.repositoryRoot, ".cache", "basic-country", COUNTRY, RUN_ID, "raw");
    const rawNames = await readdir(rawRoot).catch(() => []);
    expect(rawNames.some((name) => name.includes("hermes-json"))).toBe(false);
  });

  test("rejects duplicate opened discovery use before all effects", async () => {
    const value = await createCase();
    value.config.openedSources.push(structuredClone(value.config.openedSources[0]!));

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
  });

  test("rejects an ambiguous discovery batch before opened capture", async () => {
    const value = await createCase();
    value.discoveryResponse.candidates.push({
      ...value.discoveryResponse.candidates[0]!,
      url: "https://data.example.test/ambiguous.json?format=json",
    });

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "DISCOVERY_REJECTED", artifacts: null });
    expect(value.events).not.toContain("source:official-source");
  });

  test.each([
    ["localized text", "country.summary", 7],
    ["region", "country.region", "SOUTHEAST_ASIA"],
    ["flag", "country.flagEmoji", " "],
    ["country timestamp", "country.updatedAt", "not-a-time"],
    ["overview", "marketOverview.overview", { zh: "", en: "" }],
    ["source", "marketOverview.source", " "],
    ["source URL", "marketOverview.sourceUrl", "not-a-url"],
    ["market timestamp", "marketOverview.updatedAt", "2026-07-11T00:00:00+00:00"],
    ["credibility", "marketOverview.credibility", "UNVERIFIED"],
    ["country identity", "marketOverview.countryCode", "VN"],
    ["indicator label", "marketOverview.keyIndicators[0].label", { zh: "", en: "" }],
    ["indicator value", "marketOverview.keyIndicators[0].value", 23],
    ["indicator unit", "marketOverview.keyIndicators[0].unit", null],
    ["indicator year", "marketOverview.keyIndicators[0].year", Number.POSITIVE_INFINITY],
  ] as const)("rejects invalid normalized %s before effects", async (_label, fieldPath, normalizedValue) => {
    const value = await createCase();
    observation(value.config, fieldPath).normalizedValue = normalizedValue as BasicCollectionJsonValue;

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test.each([
    ["duplicate industry tags", "marketOverview.industryTags", ["solar", "solar"]],
    ["noncanonical industry tag order", "marketOverview.industryTags", ["wind", "solar"]],
    ["duplicate tech tags", "marketOverview.techTags", ["pv-module", "pv-module"]],
    ["noncanonical tech tag order", "marketOverview.techTags", ["inverter", "pv-module"]],
  ] as const)("rejects %s before effects", async (_label, fieldPath, normalizedValue) => {
    const value = await createCase();
    observation(value.config, fieldPath).normalizedValue = [...normalizedValue];

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID" });
    expect(value.events).toEqual([]);
  });

  test.each([
    "marketOverview.keyIndicators[0].label",
    "marketOverview.keyIndicators[0].value",
    "marketOverview.keyIndicators[0].unit",
    "marketOverview.keyIndicators[0].year",
  ])("requires a complete indicator tuple when %s is absent", async (fieldPath) => {
    const value = await createCase();
    value.config.openedSources[0]!.observations = value.config.openedSources[0]!.observations
      .filter((item) => item.fieldPath !== fieldPath);

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID" });
    expect(value.events).toEqual([]);
  });

  test("requires contiguous indicator tuple indexes", async () => {
    const value = await createCase();
    for (const item of value.config.openedSources[0]!.observations) {
      item.fieldPath = item.fieldPath.replace("keyIndicators[0]", "keyIndicators[1]");
    }

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID" });
    expect(value.events).toEqual([]);
  });

  test("requires every non-deterministic static Basic path before effects", async () => {
    const value = await createCase();
    value.config.openedSources[0]!.observations = value.config.openedSources[0]!.observations
      .filter(({ fieldPath }) => fieldPath !== "marketOverview.energyDemand");

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
  });

  test.each([
    ["non JSON", () => textResponse("<html>bad</html>", "text/html"), "SOURCE_CAPTURE_FAILED"],
    ["bad pointer", () => jsonResponse({ values: [] }), "EVIDENCE_REJECTED"],
    ["provider failure", () => Promise.reject(new Error(SENTINEL)), "SOURCE_CAPTURE_FAILED"],
  ] as const)("redacts %s source failures", async (_label, response, code) => {
    const value = await createCase();
    value.sourceResponses.set(SOURCE_URL, response);

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code, artifacts: null });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(value.events).not.toContain("llama");
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test.each([
    ["failed check", (config: MutableConfig) => { config.sourceChecks[0]!.status = "failed"; }],
    ["injection risk", (config: MutableConfig) => { config.injectionRisks.push({ sourceId: "official-source", locator: "json:/values/0", severity: "suspected", details: SENTINEL }); }],
  ] as const)("blocks %s before llama", async (_label, mutate) => {
    const value = await createCase();
    mutate(value.config);

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "PREFLIGHT_BLOCKED", artifacts: null });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(value.events).not.toContain("llama");
  });

  test("maps llama failures to a redacted stable result", async () => {
    const value = await createCase();
    value.runtime.llamaFetch = async () => { throw new Error(SENTINEL); };

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "DRAFT_FAILED", artifacts: null });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test("snapshots runtime once and rejects accessors, proxies, extra keys, and changing ports", async () => {
    const cases: unknown[] = [];
    const extra = await createCase();
    cases.push({ ...extra.runtime, extra: SENTINEL });
    const accessor = await createCase();
    cases.push(Object.defineProperty({ ...accessor.runtime }, "sourceFetch", {
      enumerable: true,
      get() { throw new Error(SENTINEL); },
    }));
    const changing = await createCase();
    let reads = 0;
    cases.push(Object.defineProperty({ ...changing.runtime }, "llamaFetch", {
      enumerable: true,
      get() { reads += 1; return reads === 1 ? changing.runtime.llamaFetch : (() => { throw new Error(SENTINEL); }); },
    }));
    const proxied = await createCase();
    cases.push({ ...proxied.runtime, sourceFetch: new Proxy(proxied.runtime.sourceFetch, {}) });

    for (const runtime of cases) {
      const value = await createCase();
      const result = await runBasicCountryCandidate(value.input, runtime as BasicCountryCandidateRuntime);
      expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
    }
  });

  test.each(["data", "staging", "country", "target"] as const)(
    "rejects %s descendant replacement during publication without writing outside outputRoot",
    async (ancestor) => {
      const value = await createCase();
      const outside = join(await tempRoot(), "outside");
      await mkdir(outside);
      value.runtime.filesystem = filesystemPort(async (operation, action) => {
        await action();
        if (operation === `create-visible-${ancestor}`) {
          const paths = {
            data: join(value.outputRoot, "data"),
            staging: join(value.outputRoot, "data", "staging"),
            country: join(value.outputRoot, "data", "staging", DIRECTORY),
            target: value.artifactRoot,
          };
          await rm(paths[ancestor], { recursive: true, force: true });
          await symlink(outside, paths[ancestor]);
        }
      });

      const result = await runBasicCountryCandidate(value.input, value.runtime);

      expect(result).toMatchObject({ ok: false, code: "OUTPUT_REJECTED", artifacts: null });
      expect(await readdir(outside)).toEqual([]);
      await expect(readdir(value.artifactRoot)).rejects.toThrow();
      expect(await packageTempEntries(value.outputRoot)).toEqual([]);
    },
  );

  test.each([
    "write-source-register.json",
    "write-extracted-facts.json",
    "write-market-overview.draft.json",
    "write-review-report.json",
    "validate-private",
    "publish-target",
    "validate-published",
    "cleanup-private",
  ] as const)("fails closed and removes package state when %s fails", async (failedOperation) => {
    const value = await createCase();
    value.runtime.filesystem = filesystemPort(async (operation, action) => {
      if (operation === failedOperation) throw new Error(SENTINEL);
      await action();
    });

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, artifacts: null });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    await expect(readdir(value.artifactRoot)).rejects.toThrow();
    expect(await packageTempEntries(value.outputRoot)).toEqual([]);
  });

  test("fails closed when visible cleanup reports failure", async () => {
    const value = await createCase();
    value.runtime.filesystem = filesystemPort(async (operation, action) => {
      if (operation === "validate-published" || operation === "cleanup-visible") throw new Error(SENTINEL);
      await action();
    });

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "OUTPUT_REJECTED", artifacts: null });
    await expect(readdir(value.artifactRoot)).rejects.toThrow();
    expect(await packageTempEntries(value.outputRoot)).toEqual([]);
  });

  test("validates privately before exposing one complete target rename", async () => {
    const value = await createCase();
    const observations: string[] = [];
    value.runtime.filesystem = filesystemPort(async (operation, action) => {
      if (operation === "validate-private") {
        await expect(readdir(value.artifactRoot)).rejects.toThrow();
        observations.push("private-only");
      }
      await action();
      if (operation === "publish-target") {
        expect((await readdir(value.artifactRoot)).sort()).toEqual([...BASIC_COUNTRY_CANDIDATE_ARTIFACTS].sort());
        observations.push("complete-visible-target");
      }
    });

    await expect(runBasicCountryCandidate(value.input, value.runtime)).resolves.toMatchObject({ ok: true });
    expect(observations).toEqual(["private-only", "complete-visible-target"]);
    expect(await packageTempEntries(value.outputRoot)).toEqual([]);
  });

  test("strictly rejects unknown config keys, transports, raw bytes, paths, and credentials with zero effects", async () => {
    const forbidden = [
      { outputRoot: "/tmp/forbidden" },
      { sourceFetch: "forbidden" },
      { body: [83, 69, 67, 82, 69, 84] },
      { token: SENTINEL },
    ];
    for (const extra of forbidden) {
      const value = await createCase();
      Object.assign(value.config, extra);
      expect(parseBasicCountryCandidateInput(value.input)).toBeNull();
      const result = await runBasicCountryCandidate(value.input, value.runtime);
      expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
      expect(value.events).toEqual([]);
      await expect(readdir(value.outputRoot)).resolves.toEqual([]);
    }
  });

  test("rejects an opened-source query outside its policy before deterministic capture", async () => {
    const value = await createCase();
    value.config.openedSources[0]!.policy.allowedQueryParameters = [];

    const result = await runBasicCountryCandidate(value.input, value.runtime);

    expect(result).toMatchObject({ ok: false, code: "INPUT_INVALID", artifacts: null });
    expect(value.events).toEqual([]);
    await expect(readdir(value.outputRoot)).resolves.toEqual([]);
  });

  test("supports RFC 6901 ~0 and ~1 pointer decoding", async () => {
    const value = await createCase();
    value.config.openedSources[0]!.observations[0]!.locator = "json:/escaped/a~1b~0c";
    value.sourceResponses.set(SOURCE_URL, () => jsonResponse({
      values: OPENED_VALUES,
      escaped: { "a/b~c": OPENED_VALUES[0] },
    }));

    await expect(runBasicCountryCandidate(value.input, value.runtime)).resolves.toMatchObject({ ok: true });
  });

  test("contains no Hermes, child-process, canonical, manifest, Prisma, coverage, AI, or publish capability", async () => {
    const sources = await Promise.all([
      readFile(new URL("./collection/basic-country-candidate-contracts.ts", import.meta.url), "utf8"),
      readFile(new URL("./collection/basic-country-candidate-runner.ts", import.meta.url), "utf8"),
      readFile(new URL("./collection/basic-country-candidate-cli.ts", import.meta.url), "utf8"),
    ]);
    const production = sources.join("\n");
    expect(production).not.toMatch(/child_process|execFile|spawn|hermes\s+chat|Prisma|collection-manifest|canonicalWrite|basic-country-import|basic-country-publication|coverage|ai-advisor|publishBasic/i);
    expect(production).not.toMatch(/runBasicHermesDiscovery\([^,]+,\s*\{[^}]*exec/s);
    expect(sources.map((source) => source.split("\n").length)).toEqual(sources.map((source) => expect.toSatisfy((lines: number) => lines < 300)));
  });
});

describe("Basic country candidate CLI", () => {
  test("classifies only help or the exact three-argument form", () => {
    expect(classifyBasicCountryCandidateArgs(["--help"])).toEqual({ mode: "help" });
    expect(classifyBasicCountryCandidateArgs(["--", "--help"])).toEqual({ mode: "help" });
    expect(classifyBasicCountryCandidateArgs([
      "--config", "/tmp/config.json",
      "--discovery", "/tmp/discovery.json",
      "--output-root", "/tmp/output",
    ])).toEqual({
      mode: "run",
      configPath: "/tmp/config.json",
      discoveryPath: "/tmp/discovery.json",
      outputRoot: "/tmp/output",
    });
    expect(classifyBasicCountryCandidateArgs(["--config", "x", "--discovery", "y"])).toEqual({ mode: "invalid" });
    expect(classifyBasicCountryCandidateArgs([
      "--", "--config", "/tmp/config.json", "--discovery", "/tmp/discovery.json", "--output-root", "/tmp/output",
    ])).toMatchObject({ mode: "run" });
  });

  test.each(["--config", "--discovery", "--output-root"])("omitting %s exits before read, fetch, or write", async (missing) => {
    const args = ["--config", "/tmp/c", "--discovery", "/tmp/d", "--output-root", "/tmp/o"];
    args.splice(args.indexOf(missing), 2);
    const dependencies = cliDependencies();

    const exitCode = await runBasicCountryCandidateCli(args, dependencies);

    expect(exitCode).toBe(2);
    expect(dependencies.readJson).not.toHaveBeenCalled();
    expect(dependencies.runCandidate).not.toHaveBeenCalled();
    expect(dependencies.stdout).toEqual([]);
    expect(dependencies.stderr).toEqual(["INPUT_INVALID\n"]);
  });

  test("passes config, discovery, and output root through separate validated boundaries and prints exact JSON", async () => {
    const root = await tempRoot();
    const repositoryRoot = join(root, "repository");
    const outputRoot = join(root, "output");
    await mkdir(repositoryRoot);
    const configPath = join(root, "config.json");
    const discoveryPath = join(root, "discovery.json");
    await writeFile(configPath, JSON.stringify(createConfig()));
    await writeFile(discoveryPath, JSON.stringify(createDiscovery()));
    const dependencies = cliDependencies(repositoryRoot);

    const exitCode = await runBasicCountryCandidateCli([
      "--config", configPath,
      "--discovery", discoveryPath,
      "--output-root", outputRoot,
    ], dependencies);

    expect(exitCode).toBe(0);
    expect(dependencies.readJson).toHaveBeenNthCalledWith(1, configPath);
    expect(dependencies.readJson).toHaveBeenNthCalledWith(2, discoveryPath);
    expect(dependencies.runCandidate).toHaveBeenCalledWith(
      { config: expect.any(Object), discoveryResponse: expect.any(Object) },
      expect.objectContaining({ repositoryRoot, outputRoot }),
    );
    expect(dependencies.stdout).toEqual([`${JSON.stringify(readyResult())}\n`]);
    expect(dependencies.stderr).toEqual([]);
  });

  test.each(["traversal", "symlink", "repository", "non-temp", "preexisting-file"] as const)(
    "rejects %s output boundaries before config read or candidate effects",
    async (scenario) => {
      const root = await tempRoot();
      const repositoryRoot = join(root, "repository");
      await mkdir(repositoryRoot);
      let outputRoot = join(root, "output");
      if (scenario === "traversal") outputRoot = join(root, "output", "..", "repository");
      if (scenario === "repository") outputRoot = join(repositoryRoot, "output");
      if (scenario === "non-temp") outputRoot = "/home/kevin/navigator-candidate-output";
      if (scenario === "symlink") {
        const target = join(root, "target");
        await mkdir(target);
        outputRoot = join(root, "linked");
        await symlink(target, outputRoot);
      }
      if (scenario === "preexisting-file") {
        const artifact = join(outputRoot, "data", "staging", DIRECTORY, RUN_ID);
        await mkdir(artifact, { recursive: true });
        await writeFile(join(artifact, "unexpected.json"), SENTINEL);
      }
      const dependencies = cliDependencies(repositoryRoot);

      const exitCode = await runBasicCountryCandidateCli([
        "--config", join(root, "config.json"),
        "--discovery", join(root, "discovery.json"),
        "--output-root", outputRoot,
      ], dependencies);

      expect(exitCode).toBe(1);
      expect(dependencies.readJson).not.toHaveBeenCalled();
      expect(dependencies.runCandidate).not.toHaveBeenCalled();
      expect(dependencies.stdout).toEqual([]);
      expect(dependencies.stderr).toEqual(["OUTPUT_REJECTED\n"]);
    },
  );

  test("redacts failure sentinels from stdout and stderr", async () => {
    const root = await tempRoot();
    const repositoryRoot = join(root, "repository");
    await mkdir(repositoryRoot);
    const dependencies = cliDependencies(repositoryRoot);
    dependencies.readJson.mockRejectedValue(new Error(SENTINEL));

    const exitCode = await runBasicCountryCandidateCli([
      "--config", join(root, SENTINEL),
      "--discovery", join(root, `discovery-${SENTINEL}.json`),
      "--output-root", join(root, "output"),
    ], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.stdout.join("") + dependencies.stderr.join("")).not.toContain(SENTINEL);
    expect(dependencies.stderr).toEqual(["INPUT_INVALID\n"]);
  });

  test.each([
    ["extra key", () => ({ ...readyResult(), sentinel: SENTINEL })],
    ["bad code", () => ({ ...readyResult(), code: SENTINEL })],
    ["bad count", () => ({ ...readyResult(), summary: { ...readyResult().summary, factCount: -1 } })],
    ["zero count", () => ({ ...readyResult(), summary: { ...readyResult().summary, sourceCount: 0 } })],
    ["fractional count", () => ({ ...readyResult(), summary: { ...readyResult().summary, factCount: 1.5 } })],
    ["bad artifacts", () => ({ ...readyResult(), artifacts: ["source-register.json", SENTINEL] })],
    ["wrong identity", () => ({ ...readyResult(), summary: { ...readyResult().summary, countryCode: "VN" } })],
    ["getter", () => Object.defineProperty({ ...readyResult() }, "code", {
      enumerable: true,
      get() { throw new Error(SENTINEL); },
    })],
    ["proxy", () => new Proxy(readyResult(), { ownKeys() { throw new Error(SENTINEL); } })],
    ["circular", () => {
      const result: Record<string, unknown> = { ...readyResult() };
      result.self = result;
      return result;
    }],
    ["sentinel", () => ({ ...readyResult(), code: SENTINEL, artifacts: [SENTINEL] })],
  ] as const)("rejects an untrusted runner result with %s without leaking", async (_label, createResult) => {
    const root = await tempRoot();
    const repositoryRoot = join(root, "repository");
    const outputRoot = join(root, "output");
    await mkdir(repositoryRoot);
    const configPath = join(root, "config.json");
    const discoveryPath = join(root, "discovery.json");
    await writeFile(configPath, JSON.stringify(createConfig()));
    await writeFile(discoveryPath, JSON.stringify(createDiscovery()));
    const dependencies = cliDependencies(repositoryRoot);
    dependencies.runCandidate.mockResolvedValue(createResult() as never);

    const exitCode = await runBasicCountryCandidateCli([
      "--config", configPath,
      "--discovery", discoveryPath,
      "--output-root", outputRoot,
    ], dependencies);

    expect(exitCode).toBe(1);
    expect(dependencies.stdout).toEqual([]);
    expect(dependencies.stderr).toEqual(["AUDIT_INVALID\n"]);
    expect(dependencies.stdout.join("") + dependencies.stderr.join("")).not.toContain(SENTINEL);
  });

  test("contains serialization and output callback failures", async () => {
    const root = await tempRoot();
    const repositoryRoot = join(root, "repository");
    const outputRoot = join(root, "output");
    await mkdir(repositoryRoot);
    const configPath = join(root, "config.json");
    const discoveryPath = join(root, "discovery.json");
    await writeFile(configPath, JSON.stringify(createConfig()));
    await writeFile(discoveryPath, JSON.stringify(createDiscovery()));
    const dependencies = cliDependencies(repositoryRoot);
    dependencies.writeStdout = () => { throw new Error(SENTINEL); };

    await expect(runBasicCountryCandidateCli([
      "--config", configPath,
      "--discovery", discoveryPath,
      "--output-root", outputRoot,
    ], dependencies)).resolves.toBe(1);
    expect(dependencies.stderr).toEqual(["AUDIT_INVALID\n"]);
  });
});

type MutableConfig = ReturnType<typeof createConfig>;

async function createCase() {
  const root = await runnerTempRoot();
  const repositoryRoot = join(root, "repository");
  const outputRoot = join(root, "output");
  await mkdir(repositoryRoot);
  await mkdir(outputRoot);
  const config = createConfig();
  const discoveryResponse = createDiscovery();
  const events: string[] = [];
  const sourceResponses = createSourceResponses();
  const sourceFetch: BasicSourceFetch = async (url) => {
    events.push(`source:${sourceIdForUrl(url)}`);
    const response = sourceResponses.get(url);
    if (response === undefined) throw new Error(`${SENTINEL}:${url}`);
    return await response();
  };
  const llamaFetch: BasicLlamaCppFetch = async () => {
    events.push("llama");
    return llamaResponse(DRAFT);
  };
  const runtime = {
    repositoryRoot,
    outputRoot,
    sourceFetch,
    llamaFetch,
    filesystem: filesystemPort(),
  } as BasicCountryCandidateRuntime & { filesystem: ReturnType<typeof filesystemPort> };
  return {
    config,
    input: { config, discoveryResponse },
    runtime,
    discoveryResponse,
    repositoryRoot,
    outputRoot,
    artifactRoot: join(outputRoot, "data", "staging", DIRECTORY, RUN_ID),
    events,
    sourceResponses,
  };
}

function createConfig(): BasicCountryCandidateConfig {
  const sourceChecks = [
    "world-bank-country",
    "world-bank-population",
    "world-bank-gdp",
    "world-bank-gdp-growth",
    "official-source",
  ].map((sourceId) => ({ sourceId, status: "passed" as "passed" | "failed", notes: null }));
  return {
    schemaVersion: "basic-country-candidate/v1" as const,
    countryCode: COUNTRY,
    countryDirectory: DIRECTORY,
    runId: RUN_ID,
    discoveryRequest: {
      countryCode: COUNTRY,
      runId: RUN_ID,
      queries: [DISCOVERY_QUERY],
      maxResults: 5,
    },
    openedSources: [{
      discoveryId: "official-source",
      policy: {
        sourceId: "official-source",
        sourceName: "Official Indonesia JSON",
        sourceUrl: SOURCE_URL,
        sourceFamily: "government" as const,
        credibility: "OFFICIAL" as const,
        accessStatus: "open" as const,
        accessNotes: null,
        publishedAt: NOW,
        promptInjectionRisk: "none" as const,
        approvedOrigins: ["https://data.example.test"],
        allowedQueryParameters: ["format"],
      },
      observations: OPENED_PATHS.map((fieldPath, index) => ({
        fieldPath,
        locator: `json:/values/${index}` as const,
        normalizedValue: structuredClone(OPENED_VALUES[index]!),
        unit: fieldPath.endsWith(".unit") ? null : null,
        year: fieldPath.endsWith(".year") ? 2025 : null,
        uncertainty: null,
      })),
    }],
    sourceChecks,
    injectionRisks: [] as Array<{ sourceId: string; locator: string; severity: "suspected" | "confirmed"; details: string }>,
    llama: { baseUrl: "http://127.0.0.1:8080/v1", model: "local-model" },
  };
}

function createDiscovery() {
  return {
    schemaVersion: "basic-hermes-discovery/v1",
    runId: RUN_ID,
    countryCode: COUNTRY,
    candidates: [{
      discoveryId: "official-source",
      provider: "searxng",
      query: DISCOVERY_QUERY,
      title: SENTINEL,
      snippet: SENTINEL,
      url: SOURCE_URL,
      discoveredAt: NOW,
      discoveryOnly: true,
    }],
  };
}

function observation(config: MutableConfig, fieldPath: string) {
  const item = config.openedSources.flatMap(({ observations }) => observations)
    .find((candidate) => candidate.fieldPath === fieldPath);
  if (item === undefined) throw new Error(`missing fixture observation ${fieldPath}`);
  return item;
}

function filesystemPort(
  run: (operation: string, action: () => Promise<void>) => Promise<void> = async (_operation, action) => await action(),
) {
  return { run };
}

async function packageTempEntries(outputRoot: string): Promise<string[]> {
  return (await readdir(outputRoot).catch(() => []))
    .filter((name) => name.startsWith(".candidate-"));
}

function createSourceResponses(): Map<string, () => ReturnType<typeof jsonResponse> | Promise<ReturnType<typeof jsonResponse>>> {
  return new Map([
    ["https://api.worldbank.org/v2/country/ID?format=json", () => jsonResponse([{ page: 1, pages: 1, per_page: "50", total: 1 }, [{ iso2Code: "ID", name: "Indonesia" }]])],
    ["https://api.worldbank.org/v2/country/ID/indicator/SP.POP.TOTL?source=2&format=json&mrv=1&per_page=1", () => worldBankIndicator("SP.POP.TOTL", 280_000_000)],
    ["https://api.worldbank.org/v2/country/ID/indicator/NY.GDP.MKTP.CD?source=2&format=json&mrv=1&per_page=1", () => worldBankIndicator("NY.GDP.MKTP.CD", 1_400_000_000_000)],
    ["https://api.worldbank.org/v2/country/ID/indicator/NY.GDP.MKTP.KD.ZG?source=2&format=json&mrv=1&per_page=1", () => worldBankIndicator("NY.GDP.MKTP.KD.ZG", 5.1)],
    [SOURCE_URL, () => jsonResponse({ values: OPENED_VALUES })],
  ]);
}

function worldBankIndicator(indicator: string, value: number) {
  return jsonResponse([
    { page: 1, pages: 1, per_page: 1, total: 1, sourceid: "2", lastupdated: "2026-07-01" },
    [{ indicator: { id: indicator }, country: { id: COUNTRY }, date: "2025", value }],
  ]);
}

function jsonResponse(value: unknown, contentType = "application/json") {
  return textResponse(JSON.stringify(value), contentType);
}

function textResponse(text: string, contentType: string) {
  const bytes = new TextEncoder().encode(text);
  return {
    status: 200,
    redirected: false,
    headers: { get: (name: string) => name.toLowerCase() === "content-type" ? contentType : null },
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  };
}

function llamaResponse(draft: unknown) {
  return textResponse(JSON.stringify({
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }],
  }), "application/json");
}

function sourceIdForUrl(url: string): string {
  if (url === SOURCE_URL) return "official-source";
  if (url.includes("SP.POP.TOTL")) return "world-bank-population";
  if (url.includes("NY.GDP.MKTP.CD")) return "world-bank-gdp";
  if (url.includes("NY.GDP.MKTP.KD.ZG")) return "world-bank-gdp-growth";
  return "world-bank-country";
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "candidate-runner-"));
  temporaryRoots.push(root);
  return root;
}

async function runnerTempRoot(): Promise<string> {
  const root = await mkdtemp("/tmp/candidate-runner-");
  temporaryRoots.push(root);
  return root;
}

function readyResult() {
  return {
    ok: true as const,
    code: "READY_FOR_HUMAN_REVIEW" as const,
    summary: { countryCode: COUNTRY, runId: RUN_ID, sourceCount: 5, factCount: 24, readyForHumanReview: true as const },
    artifacts: BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  };
}

function cliDependencies(repositoryRoot = "/tmp/repository") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    repositoryRoot,
    readJson: vi.fn(async (pathname: string) => JSON.parse(await readFile(pathname, "utf8")) as unknown),
    runCandidate: vi.fn(async () => readyResult()),
    sourceFetch: vi.fn() as unknown as BasicSourceFetch,
    llamaFetch: vi.fn() as unknown as BasicLlamaCppFetch,
    writeStdout: (text: string) => stdout.push(text),
    writeStderr: (text: string) => stderr.push(text),
    stdout,
    stderr,
  };
}
