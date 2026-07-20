import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url)).replace(
  /\/$/u,
  "",
);
const COUNTRY_DIRECTORY = "indonesia";
const RUN_ID = "data-basic-id-20260711-r2";
const CANDIDATE_HASHES = {
  "source-register.json":
    "842f5675cc2ce3f5e18bb05b4b1dc016ec5e838e059cdfaf5b9025bc785f2799",
  "extracted-facts.json":
    "953d200e586582cc21a74cc1837e5fa72ed83b2f532d4a264a205d6e7ae4b038",
  "market-overview.draft.json":
    "dd6172f7a8047b8f2701b9eb57b56681f6b7543da18dfed84055d1c3cf17adb7",
  "review-report.json":
    "a644f07748f39870e57beb0915091d002acee2aab4d41401968f59e40f157409",
} as const;

describe("Indonesia r2 approved Basic publication history", () => {
  test("preserves the immutable four-file candidate byte identity", () => {
    const candidateRoot = join(
      REPO_ROOT,
      "data",
      "staging",
      COUNTRY_DIRECTORY,
      RUN_ID,
    );

    expect(readdirSync(candidateRoot).sort(compareText)).toEqual(
      Object.keys(CANDIDATE_HASHES).sort(compareText),
    );
    for (const [name, expectedHash] of Object.entries(CANDIDATE_HASHES)) {
      expect(sha256(readFileSync(join(candidateRoot, name))), name).toBe(
        expectedHash,
      );
    }
  });

  test("preserves the exact historical approval receipt", () => {
    const receiptPath = join(
      REPO_ROOT,
      "data",
      "approvals",
      COUNTRY_DIRECTORY,
      `${RUN_ID}.json`,
    );
    const receipt = readJson(receiptPath);

    expect(sha256(readFileSync(receiptPath))).toBe(
      "aad39cb02b3d24aec4b57d2275062062b0a9a3b5531eb1289461ef41fbe73bb1",
    );
    expect(receipt).toMatchObject({
      countryDirectory: COUNTRY_DIRECTORY,
      countryCode: "ID",
      runId: RUN_ID,
      reviewerId: "github:zhaofei0923",
      submission: { submittedAt: "2026-07-15T00:01:43.000Z" },
      decidedAt: "2026-07-15T00:01:43.000Z",
      artifactSha256: CANDIDATE_HASHES,
    });
  });

  test("keeps the historical r2 candidate draft and non-AI", () => {
    const draft = readJson(
      join(
        REPO_ROOT,
        "data",
        "staging",
        COUNTRY_DIRECTORY,
        RUN_ID,
        "market-overview.draft.json",
      ),
    );

    expect(draft).toMatchObject({
      reviewStatus: "draft",
      aiUsable: false,
      countryCode: "ID",
    });
  });
});

function readJson(pathname: string): Record<string, unknown> {
  return JSON.parse(readFileSync(pathname, "utf8")) as Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
