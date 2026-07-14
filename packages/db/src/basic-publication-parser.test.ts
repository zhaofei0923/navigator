import { describe, expect, test } from "vitest";

import { createBasicCountryPublicationFixture } from "./basic-publication-test-fixture.js";
import {
  parseBasicCountryPublicationApproval,
  parseBasicCountryPublicationManifestV2,
} from "./collection/basic-publication-parser.js";

type Mutation = (value: Record<string, unknown>) => void;
type TestCase = readonly [string, Mutation, string];

describe("Basic publication parsers", () => {
  test("parses exact frozen approval and manifest contracts", () => {
    const fixture = createBasicCountryPublicationFixture();

    const approval = parseBasicCountryPublicationApproval(fixture.approvalReceipt);
    expect(approval.errors).toEqual([]);
    expect(approval.data).toEqual(fixture.approvalReceipt);
    expect(Object.isFrozen(approval.data)).toBe(true);
    expect(Object.isFrozen(approval.data?.artifactSha256)).toBe(true);

    const manifest = parseBasicCountryPublicationManifestV2(fixture.manifest);
    expect(manifest.errors).toEqual([]);
    expect(manifest.data).toEqual(fixture.manifest);
    expect(Object.isFrozen(manifest.data)).toBe(true);
  });

  test("exposes a candidate with the approval receipt country identity", () => {
    const fixture = createBasicCountryPublicationFixture();
    const { candidate, approvalReceipt } = fixture;
    const countryCodeFact = candidate.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "country.code",
    );
    const marketOverviewCountryCodeFact = candidate.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "marketOverview.countryCode",
    );
    const flagFact = candidate.extractedFacts.facts.find(
      ({ fieldPath }) => fieldPath === "country.flagEmoji",
    );

    expect(candidate.sourceRegister.countryCode).toBe(approvalReceipt.countryCode);
    expect(candidate.extractedFacts.countryCode).toBe(approvalReceipt.countryCode);
    expect(candidate.reviewReport.countryCode).toBe(approvalReceipt.countryCode);
    expect(candidate.marketOverviewDraft.countryCode).toBe(approvalReceipt.countryCode);
    expect(countryCodeFact?.evidence.map(({ rawValue, normalizedValue }) => [rawValue, normalizedValue])).toEqual([
      [approvalReceipt.countryCode, approvalReceipt.countryCode],
    ]);
    expect(marketOverviewCountryCodeFact?.evidence.map(({ rawValue, normalizedValue }) => [rawValue, normalizedValue])).toEqual([
      [approvalReceipt.countryCode, approvalReceipt.countryCode],
    ]);
    expect(flagFact?.evidence.map(({ rawValue, normalizedValue }) => [rawValue, normalizedValue])).toEqual([
      [approvalReceipt.countryCode, "\uD83C\uDDEA\uD83C\uDDFD"],
    ]);
  });

  test.each([
    ...["schemaVersion", "countryDirectory", "countryCode", "runId", "submission", "decision", "reviewerId", "decidedAt", "authorizedPublication", "artifactSha256"].map((key) => [
      `missing approval ${key}`,
      (value: Record<string, unknown>) => { delete value[key]; },
      "approvalReceipt",
    ] as const),
    ["extra approval key", (value: Record<string, unknown>) => { value.extra = true; }, "approvalReceipt"],
    ["malformed submission", (value: Record<string, unknown>) => { value.submission = { fromReviewStatus: "draft" }; }, "submission"],
    ["malformed authorization", (value: Record<string, unknown>) => { value.authorizedPublication = { coverageLevel: "BASIC" }; }, "authorizedPublication"],
    ["unsafe country directory", (value: Record<string, unknown>) => { value.countryDirectory = "SECRET/../country"; }, "countryDirectory"],
    ["unsafe run id", (value: Record<string, unknown>) => { value.runId = "SECRET/run"; }, "runId"],
    ["non-ISO2 country code", (value: Record<string, unknown>) => { value.countryCode = "EXX"; }, "countryCode"],
    ["blank reviewer", (value: Record<string, unknown>) => { value.reviewerId = "  "; }, "reviewerId"],
    ["oversized reviewer", (value: Record<string, unknown>) => { value.reviewerId = "x".repeat(65_537); }, "approvalReceipt"],
    ["non-canonical submission timestamp", (value: Record<string, unknown>) => { (value.submission as Record<string, unknown>).submittedAt = "2026-07-10 00:00:00Z"; }, "submission.submittedAt"],
    ["non-canonical decision timestamp", (value: Record<string, unknown>) => { value.decidedAt = "2026-07-11 00:00:00+00:00"; }, "decidedAt"],
    ["uppercase artifact digest", (value: Record<string, unknown>) => { (value.artifactSha256 as Record<string, unknown>)["source-register.json"] = "A".repeat(64); }, "artifactSha256.source-register.json"],
    ["short artifact digest", (value: Record<string, unknown>) => { (value.artifactSha256 as Record<string, unknown>)["source-register.json"] = "a".repeat(63); }, "artifactSha256.source-register.json"],
    ["non-hex artifact digest", (value: Record<string, unknown>) => { (value.artifactSha256 as Record<string, unknown>)["source-register.json"] = "g".repeat(64); }, "artifactSha256.source-register.json"],
    ["unsupported approval schema", (value: Record<string, unknown>) => { value.schemaVersion = "SECRET-version"; }, "schemaVersion"],
  ] as unknown as readonly TestCase[])("rejects %s without echoing input", (_name, mutate, label) => {
    const receipt = structuredClone(createBasicCountryPublicationFixture().approvalReceipt) as unknown as Record<string, unknown>;
    mutate(receipt);
    expectInvalid(parseBasicCountryPublicationApproval(receipt), label, "SECRET");
  });

  test.each([
    ...["schemaVersion", "activeRunId", "mappingVersion", "auditBundlePath", "approvalReceiptPath", "approvalReceiptSha256"].map((key) => [
      `missing manifest ${key}`,
      (value: Record<string, unknown>) => { delete value[key]; },
      "manifest",
    ] as const),
    ["extra manifest key", (value: Record<string, unknown>) => { value.extra = true; }, "manifest"],
    ["unsafe active run", (value: Record<string, unknown>) => { value.activeRunId = "SECRET/run"; }, "activeRunId"],
    ["unsupported manifest schema", (value: Record<string, unknown>) => { value.schemaVersion = "SECRET-version"; }, "schemaVersion"],
    ["unsupported mapping", (value: Record<string, unknown>) => { value.mappingVersion = "SECRET-version"; }, "mappingVersion"],
    ["uppercase receipt digest", (value: Record<string, unknown>) => { value.approvalReceiptSha256 = "A".repeat(64); }, "approvalReceiptSha256"],
    ["short receipt digest", (value: Record<string, unknown>) => { value.approvalReceiptSha256 = "a".repeat(63); }, "approvalReceiptSha256"],
    ["non-hex receipt digest", (value: Record<string, unknown>) => { value.approvalReceiptSha256 = "g".repeat(64); }, "approvalReceiptSha256"],
    ...["/absolute", "data/staging/example-land/../run-001", "data\\staging\\example-land", "data/staging/example-land/\0run-001"].flatMap((path) => [
      [`unsafe audit path ${path}`, (value: Record<string, unknown>) => { value.auditBundlePath = path; }, "auditBundlePath"],
      [`unsafe receipt path ${path}`, (value: Record<string, unknown>) => { value.approvalReceiptPath = path; }, "approvalReceiptPath"],
    ] as const),
  ] as unknown as readonly TestCase[])("rejects %s without echoing input", (_name, mutate, label) => {
    const manifest = structuredClone(createBasicCountryPublicationFixture().manifest) as unknown as Record<string, unknown>;
    mutate(manifest);
    expectInvalid(parseBasicCountryPublicationManifestV2(manifest), label, "SECRET");
  });
});

function expectInvalid(
  result: Readonly<{ data: unknown; errors: readonly string[] }>,
  label: string,
  secret: string,
): void {
  expect(result.data).toBeNull();
  expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining(label)]));
  expect(result.errors.join("\n")).not.toContain(secret);
}
