import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const PLATFORM_MILESTONE_DESIGN =
  "docs/superpowers/specs/2026-07-18-six-basic-platform-milestone-design.md";
const PLATFORM_API_PLAN =
  "docs/superpowers/plans/2026-07-18-platform-api-1.md";

const M1_IMPLEMENTATION_SHA =
  "015010c29a5a0deb39ef32cbe4e1a9fe8fd07840";
const M1_IMPLEMENTATION_CI_RUN = "29693475214";

const SIX_BASIC_ACTIVE_RUNS = [
  "data-basic-id-20260711-r2",
  "data-basic-vn-20260715-r3",
  "data-basic-sa-20260717-r2",
  "data-basic-ae-20260717-r1",
  "data-basic-br-20260718-r2",
  "data-basic-za-20260718-r2",
] as const;

const GATE_0_APPROVAL_LINE =
  "- 2026-07-19 进度：Gate 0 已精确批准 `@nestjs/common@11.1.28`、`@nestjs/core@11.1.28`、`@nestjs/platform-express@11.1.28`、`reflect-metadata@0.2.2`、`rxjs@7.8.2` 与开发依赖 `@nestjs/testing@11.1.28`；本卡任务已完成。该批准不覆盖其他新增依赖。";

const ID_STANDARD_DRAFT_REQUIREMENTS = [
  {
    description: "records approval of the first source catalog",
    pattern:
      /首批来源目录[\s\S]{0,100}(?:身份和采集范围获批|已获批|已批准)|(?:并批准|已获批|已批准)[\s\S]{0,120}首批来源目录/,
  },
  {
    description: "limits current authorization to a draft candidate",
    pattern: /仅授权[\s\S]{0,40}draft candidate/,
  },
  {
    description: "keeps the candidate in draft review state",
    pattern: /`reviewStatus = draft`/,
  },
  {
    description: "keeps the candidate ineligible for AI",
    pattern: /`aiUsable = false`/,
  },
  {
    description: "forbids promotion to reviewed or published state",
    pattern: /不得进入[\s\S]{0,80}`?pending`?[\s\S]{0,40}`?published`?/,
  },
  {
    description: "keeps facts and bilingual text behind later approval",
    pattern:
      /(?:不等于|不批准|未批准)[\s\S]{0,80}(?:提取)?事实[\s\S]{0,100}双语文本|(?:提取)?事实[\s\S]{0,100}双语文本[\s\S]{0,220}(?:未批准|另行人工批准|分别人工批准|须另行批准|分别批准)/,
  },
  {
    description: "keeps M2 incomplete at the draft-candidate gate",
    pattern: /M2 不得标记完成/,
  },
  {
    description: "forbids canonical and production database writes",
    pattern:
      /(?:不得|不授权|不等于批准)[\s\S]{0,220}canonical[\s\S]{0,60}生产数据库/,
  },
  {
    description: "forbids KnowledgeChunk creation and AI retrieval",
    pattern:
      /(?:不得|不授权|不等于批准)[\s\S]{0,260}KnowledgeChunk[\s\S]{0,100}AI (?:检索|资格)/,
  },
] as const;

const UNAUTHORIZED_ID_STANDARD_CLAIMS = [
  /(?:提取)?事实已(?:获)?批准/,
  /双语文本已(?:获)?批准/,
  /STANDARD 发布已(?:获)?批准/,
  /(?:canonical|生产数据库写入)已(?:获)?批准/,
  /(?:KnowledgeChunk|AI 检索)已(?:获)?批准/,
  /`reviewStatus = (?:pending|published)`/,
  /`aiUsable = true`/,
  /(?:^|[，。；：\s])(?:允许|授权|可)[^。\n]{0,100}(?:进入|转为)[^。\n]{0,30}`?(?:pending|published)`?/m,
  /(?:^|[，。；：\s])(?:允许|授权|可)[^。\n]{0,100}(?:写入|修改)[^。\n]{0,40}(?:canonical|生产数据库)/m,
  /(?:^|[，。；：\s])(?:允许|授权|可)[^。\n]{0,100}(?:创建|生成)[^。\n]{0,40}KnowledgeChunk/m,
  /(?:^|[，。；：\s])(?:允许|授权|可)[^。\n]{0,100}(?:进入|启用|用于)[^。\n]{0,40}AI (?:检索|问答)/m,
] as const;

const ACTIVE_MILESTONE_SECTIONS = [
  {
    documentPath: "docs/roadmap.md",
    idBoundary: {
      start: "#### `DATA-STANDARD-ID`",
      end: "#### `DATA-COMPLETE-<ISO2>`",
    },
    m1Boundary: { start: "### 1.1 当前执行里程碑", end: "\n---\n" },
    p4Boundary: {
      start: "### P4 — 权限 / 会员 / 留资",
      end: "### P5 — Admin 后台",
    },
    m1CompletePattern: /M1 生产平台底座[\s\S]{0,100}\*\*已完成\*\*/,
  },
  {
    documentPath: "docs/country-rollout.md",
    idBoundary: {
      start: "### 六国 BASIC 基线与下一阶段启动门槛",
      end: "### SA r1 audit history",
    },
    m1Boundary: {
      start: "### 六国 BASIC 基线与下一阶段启动门槛",
      end: "### SA r1 audit history",
    },
    p4Boundary: { start: "## 4. 建设流程", end: "\n---\n" },
    m1CompletePattern: /M1 已完成全量验证、独立审查/,
  },
  {
    documentPath: PLATFORM_MILESTONE_DESIGN,
    idBoundary: {
      start: "2. 项目所有者已选择",
      end: "3. 平台底座与试点国",
    },
    m1Boundary: { start: "## 3. 里程碑", end: "## 4. 任务切片" },
    p4Boundary: {
      start: "## 4. 任务切片",
      end: "## 5. 明确不授权的事项",
    },
    m1CompletePattern: /M1 生产平台底座 \| 已完成/,
  },
] as const;

const readRootFile = (filePath: string) =>
  readFileSync(join(process.cwd(), filePath), "utf8");

const readBoundedSection = (
  documentPath: string,
  boundary: { readonly start: string; readonly end: string },
) => {
  const policy = readRootFile(documentPath);
  const startIndex = policy.indexOf(boundary.start);
  const endIndex = policy.indexOf(boundary.end, startIndex + boundary.start.length);

  if (startIndex === -1 || endIndex === -1) {
    throw new Error(
      `${documentPath}: missing section boundary ${boundary.start} -> ${boundary.end}`,
    );
  }

  return policy.slice(startIndex, endIndex);
};

describe("Platform milestone documentation policy", () => {
  it("locks the six-country M0 identity and M0-to-M1 dependency", () => {
    const design = readRootFile(PLATFORM_MILESTONE_DESIGN);
    const roadmap = readRootFile("docs/roadmap.md");

    for (const activeRun of SIX_BASIC_ACTIVE_RUNS) {
      expect(design, activeRun).toContain(activeRun);
    }
    expect(roadmap).toContain("M0 --> PF");
    expect(roadmap).not.toContain("P2 --> PF");
  });

  it("keeps ID STANDARD parallel to M1 and draft-only after source-catalog approval", () => {
    for (const milestoneDocument of ACTIVE_MILESTONE_SECTIONS) {
      const { documentPath } = milestoneDocument;
      const policy = readBoundedSection(
        documentPath,
        milestoneDocument.idBoundary,
      );

      expect(policy, `${documentPath}: selected pilot`).toContain(
        "DATA-STANDARD-ID",
      );
      expect(policy, `${documentPath}: M1 parallelism`).toMatch(
        /DATA-STANDARD-ID[\s\S]{0,240}与 M1 并行|与 M1 并行[\s\S]{0,240}DATA-STANDARD-ID/,
      );
      for (const requirement of ID_STANDARD_DRAFT_REQUIREMENTS) {
        expect(
          policy,
          `${documentPath}: ${requirement.description}`,
        ).toMatch(requirement.pattern);
      }

      expect(policy, `${documentPath}: real ID remains Basic`).toMatch(
        /ID[^\n]{0,160}(?:真实 canonical publication|真实 canonical)[^\n]{0,80}(?:仍|保持)[^\n]{0,20}BASIC|ID[^\n]{0,160}(?:仍|保持)[^\n]{0,20}(?:真实 )?BASIC/,
      );
      for (const unauthorizedClaim of UNAUTHORIZED_ID_STANDARD_CLAIMS) {
        expect(
          policy,
          `${documentPath}: unauthorized positive claim ${unauthorizedClaim.source}`,
        ).not.toMatch(unauthorizedClaim);
      }
    }
  });

  it("records completed M1 acceptance and keeps P4-1 behind its human gate", () => {
    for (const milestoneDocument of ACTIVE_MILESTONE_SECTIONS) {
      const { documentPath } = milestoneDocument;
      const m1Policy = readBoundedSection(
        documentPath,
        milestoneDocument.m1Boundary,
      );
      const p4Policy = readBoundedSection(
        documentPath,
        milestoneDocument.p4Boundary,
      );

      expect(m1Policy, `${documentPath}: M1 is complete`).toMatch(
        milestoneDocument.m1CompletePattern,
      );
      expect(m1Policy, `${documentPath}: full verification gate`).toMatch(
        /全量验证/,
      );
      expect(m1Policy, `${documentPath}: independent review gate`).toMatch(
        /独立审查/,
      );
      expect(m1Policy, `${documentPath}: merged-main CI gate`).toMatch(
        /(?:merged-main[\s\S]{0,80}CI|CI-SHA 对齐)/,
      );
      expect(m1Policy, `${documentPath}: implementation SHA`).toContain(
        M1_IMPLEMENTATION_SHA,
      );
      expect(m1Policy, `${documentPath}: implementation CI run`).toContain(
        M1_IMPLEMENTATION_CI_RUN,
      );
      expect(m1Policy, `${documentPath}: stale pending state`).not.toMatch(
        /收尾验证中|仍保持[“\"]进行中[”\"]|M1 正在(?:进行|等待)/,
      );
      expect(p4Policy, `${documentPath}: P4-1 human gate`).toMatch(
        /P4-1[\s\S]{0,100}(?:仍须人工关口|仍须人工批准|须另行人工批准|另行取得人工批准)/,
      );
      expect(p4Policy, `${documentPath}: P4-1 direct implementation`).not.toMatch(
        /P4-1[^\n]{0,120}(?:可直接实施|无需[^\n]{0,30}人工批准|已(?:获)?批准)/,
      );
    }
  });

  it("records the P2.5 task sequence as completed", () => {
    const platformFoundation = readBoundedSection("docs/roadmap.md", {
      start: "### P2.5 — 生产平台底座",
      end: "### P3 — AI 顾问",
    });

    expect(platformFoundation).toMatch(
      /P2\.5 已按 DB → API → OPS 严格串行完成/,
    );
    expect(platformFoundation).not.toMatch(
      /P2\.5 现在启动|以下三张卡严格串行交付/,
    );
  });

  it("releases the actual P3, P4, and P5 task sections after full M1 acceptance", () => {
    for (const boundary of [
      { start: "### P3 — AI 顾问", end: "### P4 — 权限 / 会员 / 留资" },
      { start: "### P4 — 权限 / 会员 / 留资", end: "### P5 — Admin 后台" },
      { start: "### P5 — Admin 后台", end: "### P6 — 小程序 / H5" },
    ] as const) {
      const policy = readBoundedSection("docs/roadmap.md", boundary);

      expect(policy, boundary.start).toMatch(
        /M1 全量验收及 merged-main CI-SHA 对齐已完成/,
      );
      expect(policy, boundary.start).not.toMatch(/P2\.5 核心完成后/);
      expect(policy, boundary.start).not.toMatch(
        /仅(?:可|在)[^\n]{0,80}M1[^\n]{0,80}(?:后|通过后)/,
      );
    }

    const p4Policy = readBoundedSection("docs/roadmap.md", {
      start: "### P4 — 权限 / 会员 / 留资",
      end: "### P5 — Admin 后台",
    });
    expect(p4Policy).toMatch(
      /P4-1[\s\S]{0,120}(?:权限逻辑)?另行取得人工批准后实施/,
    );
  });

  it("keeps production AI and membership behind their remaining gates", () => {
    const roadmap = readRootFile("docs/roadmap.md");
    const m4Line = roadmap
      .split("\n")
      .find((line) => line.startsWith("| M4 AI 受控 Beta |"));
    const m5Line = roadmap
      .split("\n")
      .find((line) => line.startsWith("| M5 会员与报告受控 Beta |"));

    expect(m4Line).toBeDefined();
    expect(m4Line).toContain("生产 Beta 仍封锁");
    for (const requirement of [
      "ID 已独立发布为 STANDARD",
      "KnowledgeChunk",
      "正式 Prompt",
      "检索默认值",
      "`aiUsable`",
      "人工批准",
    ]) {
      expect(m4Line).toContain(requirement);
    }

    expect(m5Line).toBeDefined();
    for (const requirement of [
      "至少一个真实受控资源",
      "服务端权限矩阵",
      "权益与计费边界人工确认",
    ]) {
      expect(m5Line).toContain(requirement);
    }

    const p3Policy = readBoundedSection("docs/roadmap.md", {
      start: "### P3 — AI 顾问",
      end: "### P4 — 权限 / 会员 / 留资",
    });
    expect(p3Policy).toMatch(
      /P3-3 AI 受控 Beta 启用 ⚠️[\s\S]{0,1200}人工确认：是（生产 AI、正式 Prompt 和检索默认值均属人工关口）/,
    );

    const p4Policy = readBoundedSection("docs/roadmap.md", {
      start: "### P4 — 权限 / 会员 / 留资",
      end: "### P5 — Admin 后台",
    });
    expect(p4Policy).toMatch(
      /P4-4 会员与报告受控 Beta ⚠️[\s\S]{0,1200}人工确认：是（真实权益、会员等级、价格和计费边界须在启动前批准）/,
    );
  });

  it("locks the completed API plan and exact Gate 0 dependency approval", () => {
    const apiPlan = readRootFile(PLATFORM_API_PLAN);
    const taskNumbers = [...apiPlan.matchAll(/^## 任务 (\d+)：/gm)].map(
      ([, taskNumber]) => Number(taskNumber),
    );
    expect(taskNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);

    const roadmapApiCard = readBoundedSection("docs/roadmap.md", {
      start: "#### PLATFORM-API-1 NestJS 国家只读 API",
      end: "#### PLATFORM-OPS-1 并发与运行治理基线",
    });
    const gate0ApprovalLines = roadmapApiCard
      .split("\n")
      .filter((line) => line.includes("Gate 0"));
    const countryRolloutMilestone = readBoundedSection(
      "docs/country-rollout.md",
      ACTIVE_MILESTONE_SECTIONS[1].m1Boundary,
    );
    const roadmapMilestone = readBoundedSection(
      "docs/roadmap.md",
      ACTIVE_MILESTONE_SECTIONS[0].m1Boundary,
    );

    expect(gate0ApprovalLines).toEqual([GATE_0_APPROVAL_LINE]);
    expect(countryRolloutMilestone).toMatch(/Gate 0 精确依赖已获批准/);
    for (const policy of [roadmapMilestone, countryRolloutMilestone]) {
      expect(policy).toMatch(
        /`?PLATFORM-DB-1`?、`?PLATFORM-API-1`?、`?PLATFORM-OPS-1`? 均已完成/,
      );
      expect(policy).not.toContain("等待 Gate 0");
      expect(policy).not.toContain("任务 3–6");
    }
  });
});
