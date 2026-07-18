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

const REAL_BASIC_PUBLICATION_DOCUMENTS = [
  {
    documentPath: "docs/indonesia-seed.md",
    requirements: [
      { description: "marks ID as an approved real Basic publication", pattern: /已批准真实 `BASIC` canonical publication/i },
      { description: "records the immutable candidate identity", pattern: /data-basic-id-20260711-r2/ },
      { description: "records the receipt digest", pattern: /aad39cb02b3d24aec4b57d2275062062b0a9a3b5531eb1289461ef41fbe73bb1/ },
      { description: "keeps the canonical three-file allowlist", pattern: /必须且只能包含/ },
    ],
  },
  {
    documentPath: "docs/testing.md",
    requirements: [
      { description: "marks ID as an approved real Basic publication", pattern: /已批准的真实 `BASIC` canonical publication/i },
      { description: "requires canonical allowlist tests", pattern: /canonical 三文件 allowlist/ },
    ],
  },
  {
    documentPath: "AGENTS.md",
    requirements: [
      { description: "marks ID as an approved real Basic publication", pattern: /已批准的真实 BASIC canonical publication/i },
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

const SIX_BASIC_ACTIVE_RUNS = [
  "data-basic-id-20260711-r2",
  "data-basic-vn-20260715-r3",
  "data-basic-sa-20260717-r2",
  "data-basic-ae-20260717-r1",
  "data-basic-br-20260718-r2",
  "data-basic-za-20260718-r2",
] as const;

const PLATFORM_MILESTONE_DESIGN =
  "docs/superpowers/specs/2026-07-18-six-basic-platform-milestone-design.md";

const ID_STANDARD_GATE =
  "来源、事实、双语文本、STANDARD 发布、`aiUsable`、真实 ID KnowledgeChunk 创建与可检索资格、COMPLETE 升级均须分别人工批准。";

const ACTIVE_MILESTONE_DOCUMENTS = [
  "docs/roadmap.md",
  "docs/country-rollout.md",
  PLATFORM_MILESTONE_DESIGN,
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

  it("keeps the real Indonesia Basic publication boundary explicit", () => {
    for (const publicationDocument of REAL_BASIC_PUBLICATION_DOCUMENTS) {
      const policy = readRootFile(publicationDocument.documentPath);

      for (const requirement of publicationDocument.requirements) {
        expect(
          policy,
          `${publicationDocument.documentPath}: ${requirement.description}`,
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

  it("locks the six-country M0 identity and M0-to-M1 dependency", () => {
    const design = readRootFile(PLATFORM_MILESTONE_DESIGN);
    const roadmap = readRootFile("docs/roadmap.md");

    for (const activeRun of SIX_BASIC_ACTIVE_RUNS) {
      expect(design, activeRun).toContain(activeRun);
    }
    expect(roadmap).toContain("M0 --> PF");
    expect(roadmap).not.toContain("P2 --> PF");
  });

  it("keeps ID STANDARD parallel to M1 without widening its human gates", () => {
    for (const documentPath of ACTIVE_MILESTONE_DOCUMENTS) {
      const policy = readRootFile(documentPath);

      expect(policy, `${documentPath}: selected pilot`).toContain(
        "DATA-STANDARD-ID",
      );
      expect(policy, `${documentPath}: M1 parallelism`).toMatch(
        /DATA-STANDARD-ID[\s\S]{0,240}与 M1 并行|与 M1 并行[\s\S]{0,240}DATA-STANDARD-ID/,
      );
      expect(policy, `${documentPath}: independent gates`).toContain(
        ID_STANDARD_GATE,
      );
    }
  });
});
