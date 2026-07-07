import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

const schemaPath = new URL("../prisma/schema.prisma", import.meta.url);
const migrationPath = new URL(
  "../prisma/migrations/0001_init/migration.sql",
  import.meta.url,
);

const requiredModels = [
  "Country",
  "ModuleCoverage",
  "MarketOverview",
  "Policy",
  "Risk",
  "Opportunity",
  "Project",
  "Partner",
  "ChineseCompany",
  "EntryStrategy",
  "Report",
  "KnowledgeChunk",
  "Lead",
] as const;

const coreBusinessModels = [
  "MarketOverview",
  "Policy",
  "Risk",
  "Opportunity",
  "Project",
  "Partner",
  "ChineseCompany",
  "EntryStrategy",
  "Report",
  "KnowledgeChunk",
] as const;

const metaFieldPatterns = [
  /\bsource\s+String\b/,
  /\bsourceUrl\s+String\?\s+@map\("source_url"\)/,
  /\bcollectedAt\s+DateTime\s+@map\("collected_at"\)/,
  /\bupdatedAt\s+DateTime\s+@map\("updated_at"\)/,
  /\bcredibility\s+Credibility\b/,
  /\breviewStatus\s+ReviewStatus\s+@map\("review_status"\)/,
  /\baiUsable\s+Boolean\s+@map\("ai_usable"\)/,
  /\bcountryCode\s+String\s+@map\("country_code"\)/,
  /\bindustryTags\s+IndustryTag\[\]\s+@map\("industry_tags"\)/,
  /\btechTags\s+TechTag\[\]\s+@map\("tech_tags"\)/,
] as const;

function readSchema(): string {
  return readFileSync(schemaPath, "utf8");
}

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

function getBlock(source: string, blockType: "model" | "enum", name: string): string {
  const match = source.match(
    new RegExp(`${blockType}\\s+${name}\\s+\\{([\\s\\S]*?)\\n\\}`),
  );
  if (match === null || match[1] === undefined) {
    throw new Error(`Missing ${blockType} ${name}`);
  }

  return match[1];
}

function getEnumValues(schema: string, enumName: string): string[] {
  return getBlock(schema, "enum", enumName)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("@@"))
    .map((line) => {
      const [value] = line.split(/\s+/);
      if (value === undefined) {
        throw new Error(`Missing enum value in ${enumName}`);
      }

      const mapped = line.match(/@map\("([^"]+)"\)/);
      return mapped?.[1] ?? value;
    });
}

describe("Prisma data schema", () => {
  test("declares the PostgreSQL datasource and Prisma client generator", () => {
    const schema = readSchema();

    expect(schema).toMatch(/provider\s+=\s+"postgresql"/);
    expect(schema).toMatch(/url\s+=\s+env\("DATABASE_URL"\)/);
    expect(schema).toMatch(/provider\s+=\s+"prisma-client-js"/);
  });

  test("declares the P1-1 country, module, knowledge, and lead models", () => {
    const schema = readSchema();

    for (const modelName of requiredModels) {
      expect(schema).toContain(`model ${modelName} {`);
    }
  });

  test("requires all standard meta fields on every core business model", () => {
    const schema = readSchema();

    for (const modelName of coreBusinessModels) {
      const model = getBlock(schema, "model", modelName);

      for (const fieldPattern of metaFieldPatterns) {
        expect(model, `${modelName} missing ${fieldPattern}`).toMatch(fieldPattern);
      }
    }
  });

  test("stores LocalizedText and structured module arrays as Json", () => {
    const schema = readSchema();

    expect(getBlock(schema, "model", "Country")).toMatch(/\bname\s+Json\b/);
    expect(getBlock(schema, "model", "Country")).toMatch(/\bsummary\s+Json\b/);
    expect(getBlock(schema, "model", "MarketOverview")).toMatch(
      /\bkeyIndicators\s+Json\s+@map\("key_indicators"\)/,
    );
    expect(getBlock(schema, "model", "EntryStrategy")).toMatch(/\bsteps\s+Json\b/);
  });

  test("uses documented fixed value enums for country region and policy type", () => {
    const schema = readSchema();

    expect(getBlock(schema, "model", "Country")).toMatch(/\bregion\s+Region\b/);
    expect(getBlock(schema, "model", "Policy")).toMatch(
      /\bpolicyType\s+PolicyType\s+@map\("policy_type"\)/,
    );
  });

  test("declares KnowledgeChunk pgvector fields and source linkage", () => {
    const knowledgeChunk = getBlock(readSchema(), "model", "KnowledgeChunk");

    expect(knowledgeChunk).toMatch(
      /\bembeddingZh\s+Unsupported\("vector"\)\s+@map\("embedding_zh"\)/,
    );
    expect(knowledgeChunk).toMatch(
      /\bembeddingEn\s+Unsupported\("vector"\)\s+@map\("embedding_en"\)/,
    );
    expect(knowledgeChunk).toMatch(/\bsourceModule\s+ModuleKey\s+@map\("source_module"\)/);
    expect(knowledgeChunk).toMatch(/\bsourceId\s+String\s+@map\("source_id"\)/);
  });

  test("declares enums synchronized with the documented values", () => {
    const schema = readSchema();

    expect(getEnumValues(schema, "CoverageLevel")).toEqual([
      "BASIC",
      "STANDARD",
      "COMPLETE",
    ]);
    expect(getEnumValues(schema, "ModuleKey")).toEqual([
      "market-overview",
      "policy",
      "risk",
      "opportunities",
      "projects",
      "partners",
      "chinese-companies",
      "entry-strategy",
      "ai-advisor",
      "reports",
    ]);
    expect(getEnumValues(schema, "ReviewStatus")).toEqual([
      "draft",
      "pending",
      "published",
    ]);
    expect(getEnumValues(schema, "Credibility")).toEqual([
      "OFFICIAL",
      "VERIFIED",
      "ESTIMATED",
      "UNVERIFIED",
    ]);
    expect(getEnumValues(schema, "ModuleCoverageStatus")).toEqual([
      "BUILDING",
      "PARTIAL",
      "COMPLETE",
    ]);
    expect(getEnumValues(schema, "RiskLevel")).toEqual(["LOW", "MEDIUM", "HIGH"]);
    expect(getEnumValues(schema, "ProjectStatus")).toEqual([
      "PLANNING",
      "BIDDING",
      "CONSTRUCTION",
      "OPERATIONAL",
    ]);
    expect(getEnumValues(schema, "AccessLevel")).toEqual([
      "FREE",
      "MEMBER",
      "PREMIUM",
    ]);
    expect(getEnumValues(schema, "IndustryTag")).toEqual([
      "solar",
      "wind",
      "storage",
      "ev",
      "hydrogen",
      "grid",
      "bess-mfg",
      "epc",
    ]);
    expect(getEnumValues(schema, "TechTag")).toEqual([
      "pv-module",
      "inverter",
      "onshore-wind",
      "offshore-wind",
      "lfp",
      "ncm",
      "electrolyzer",
    ]);
    expect(getEnumValues(schema, "Region")).toEqual([
      "southeast-asia",
      "south-asia",
      "middle-east",
      "africa",
      "latin-america",
      "europe",
      "central-asia",
    ]);
    expect(getEnumValues(schema, "PolicyType")).toEqual([
      "incentive",
      "tariff",
      "localization",
      "permit",
      "tax",
      "import-export",
    ]);
  });
});

describe("P1-1 migration", () => {
  test("enables pgvector and creates the knowledge chunk vector columns", () => {
    const migration = readMigration();

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector;");
    expect(migration).toContain('CREATE TABLE "knowledge_chunks"');
    expect(migration).toContain('"embedding_zh" vector NOT NULL');
    expect(migration).toContain('"embedding_en" vector NOT NULL');
  });
});
