import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BASIC_FIRST_RULE =
  "所有国家（包括 `ID`）的首次真实数据交付必须恰好为 `BASIC`。";

const ACTIVE_POLICY_DOCUMENTS = [
  "AGENTS.md",
  "docs/roadmap.md",
  "docs/country-rollout.md",
  "docs/indonesia-seed.md",
  "docs/product-brief.md",
  "docs/coverage-levels.md",
  "docs/basic-country-collection.md",
] as const;

const RETIRED_CLAIMS = [
  "印尼是首个完整样板国家",
  "印尼是首个 Complete 样板国家",
  "除既有 Complete 参考国家 `ID` 外",
  "`ID` 保持 Complete 参考样板",
  "印尼判定为 COMPLETE",
  "完整覆盖（印尼为样板）",
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
    for (const documentPath of ACTIVE_POLICY_DOCUMENTS) {
      expect(readRootFile(documentPath), documentPath).toContain(BASIC_FIRST_RULE);
    }
  });

  it("does not retain country-specific Indonesia-Complete rollout claims", () => {
    const activePolicy = ACTIVE_POLICY_DOCUMENTS.map(readRootFile).join("\n");

    for (const retiredClaim of RETIRED_CLAIMS) {
      expect(activePolicy).not.toContain(retiredClaim);
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
