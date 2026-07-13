import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASIC_FIRST_RULE =
  "所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。";

const BASIC_FIRST_POLICY_DOCUMENTS = [
  "AGENTS.md",
  "docs/roadmap.md",
  "docs/country-rollout.md",
  "docs/indonesia-seed.md",
  "docs/product-brief.md",
  "docs/coverage-levels.md",
  "docs/basic-country-collection.md",
] as const;

const RETIRED_CLAIM_SCAN_DOCUMENTS = [
  ...BASIC_FIRST_POLICY_DOCUMENTS,
  "docs/data-schema.md",
  "docs/testing.md",
] as const;

const RETIRED_CLAIMS = [
  "印尼是首个完整样板国家",
  "印尼是首个 Complete 样板国家",
  "除既有 Complete 参考国家 `ID` 外",
  "`ID` 保持 Complete 参考样板",
  "印尼判定为 COMPLETE",
  "完整覆盖（印尼为样板）",
  "fixture 参考印尼样板",
] as const;

const FIXTURE_BOUNDARY_DOCUMENTS = [
  {
    documentPath: "docs/indonesia-seed.md",
    requirements: [
      { description: "marks the fixture as synthetic", pattern: /synthetic regression fixture/i },
      { description: "marks the fixture as non-real", pattern: /(?:不是|不得[^。\n]*视为)[^。\n]*真实/ },
      { description: "marks the fixture as non-rollout", pattern: /不是[^。\n]*rollout/ },
      { description: "forbids copying the fixture", pattern: /(?:不可|不得)复制/ },
    ],
  },
  {
    documentPath: "docs/testing.md",
    requirements: [
      { description: "marks the fixture as synthetic", pattern: /synthetic regression fixture/i },
      { description: "marks the fixture as non-real", pattern: /不是[^。\n]*真实/ },
      { description: "marks the fixture as non-rollout", pattern: /不是[^。\n]*rollout/ },
      {
        description: "forbids copying the fixture",
        pattern: /(?:不可|不能|不得)复制|不是[^。\n]*可复制/,
      },
    ],
  },
  {
    documentPath: "AGENTS.md",
    requirements: [
      { description: "marks the fixture as legacy synthetic", pattern: /legacy synthetic regression fixture/i },
      { description: "marks the fixture as a non-real country delivery", pattern: /非真实国家交付/ },
    ],
  },
] as const;

const OPERATIONAL_POLICY_DOCUMENTS = [
  "docs/basic-country-collection.md",
  "docs/indonesia-seed.md",
  "docs/country-rollout.md",
] as const;

const OPERATIONAL_REQUIREMENTS = [
  {
    description: "keeps the other nine modules at BUILDING",
    pattern: /其余九个模块(?:必须)?均为 `BUILDING`/,
  },
  {
    description: "keeps the other nine modules free of published records",
    pattern: /其余九个模块[\s\S]{0,180}(?:没有|无)(?:任何)?\s*`?published`?\s*记录/,
  },
  {
    description: "keeps Basic records ineligible for AI",
    pattern: /`aiUsable\s*=\s*false`/,
  },
  {
    description: "forbids Basic knowledge chunks",
    pattern: /(?:不产生|不创建|不得创建|没有)知识片段/,
  },
  {
    description: "requires a separate human-approved upgrade after Basic acceptance",
    pattern:
      /(?:`?STANDARD`?[\s\S]{0,40}`?COMPLETE`?[\s\S]{0,180}Basic 验收后[\s\S]{0,180}(?:单独|独立)[\s\S]{0,40}经人工批准[\s\S]{0,80}升级任务|(?:Basic 验收后|先按 Basic 交付，再在)[\s\S]{0,220}(?:单独|独立)[\s\S]{0,40}经人工批准[\s\S]{0,80}升级任务[\s\S]{0,160}`?STANDARD`?[\s\S]{0,40}`?COMPLETE`?)/i,
  },
] as const;

const readRootFile = (filePath: string) =>
  readFileSync(join(process.cwd(), filePath), "utf8");

describe("Basic-first documentation policy", () => {
  it("states the Basic-first rule in every active policy document", () => {
    for (const documentPath of BASIC_FIRST_POLICY_DOCUMENTS) {
      expect(readRootFile(documentPath), documentPath).toContain(BASIC_FIRST_RULE);
    }
  });

  it("does not retain country-specific Indonesia-Complete rollout claims", () => {
    for (const documentPath of RETIRED_CLAIM_SCAN_DOCUMENTS) {
      const policy = readRootFile(documentPath);

      for (const retiredClaim of RETIRED_CLAIMS) {
        expect(policy, `${documentPath}: ${retiredClaim}`).not.toContain(
          retiredClaim,
        );
      }
    }
  });

  it("keeps every fixture boundary explicit in its owning document", () => {
    for (const fixtureDocument of FIXTURE_BOUNDARY_DOCUMENTS) {
      const policy = readRootFile(fixtureDocument.documentPath);

      for (const requirement of fixtureDocument.requirements) {
        expect(
          policy,
          `${fixtureDocument.documentPath}: ${requirement.description}`,
        ).toMatch(requirement.pattern);
      }
    }
  });

  it("keeps the Basic collection boundary and approved upgrade gate", () => {
    for (const documentPath of OPERATIONAL_POLICY_DOCUMENTS) {
      const policy = readRootFile(documentPath);

      for (const requirement of OPERATIONAL_REQUIREMENTS) {
        expect(
          policy,
          `${documentPath}: ${requirement.description}`,
        ).toMatch(requirement.pattern);
      }
    }
  });

  it("keeps the DATA-BASIC-ID source-boundary run explicitly Basic", () => {
    const sourceBoundary = readRootFile(
      "docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md",
    );

    expect(sourceBoundary).toMatch(/DATA-BASIC-ID[\s\S]{0,240}`BASIC`/);
  });
});
