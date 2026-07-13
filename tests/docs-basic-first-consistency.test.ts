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
    const collectionPolicy = [
      readRootFile("docs/basic-country-collection.md"),
      readRootFile("docs/indonesia-seed.md"),
      readRootFile("docs/country-rollout.md"),
    ].join("\n");

    expect(collectionPolicy).toContain("其余九个模块均为 `BUILDING`");
    expect(collectionPolicy).toContain("`aiUsable = false`");
    expect(collectionPolicy).toContain("不产生知识片段");
    expect(collectionPolicy).toContain("经人工批准的升级任务");
  });

  it("keeps the DATA-BASIC-ID source-boundary run explicitly Basic", () => {
    const sourceBoundary = readRootFile(
      "docs/superpowers/specs/2026-07-12-basic-source-boundary-design.md",
    );

    expect(sourceBoundary).toMatch(/DATA-BASIC-ID[\s\S]{0,240}`BASIC`/);
  });
});
