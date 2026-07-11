import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = process.cwd();

function walkMarkdown(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const pathname = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(pathname));
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(pathname);
  }
  return files;
}

function listLivingMarkdown(root: string): string[] {
  return walkMarkdown(join(root, "docs"))
    .map((path) => relative(root, path).replaceAll("\\", "/"))
    .filter((path) => !path.startsWith("docs/superpowers/"))
    .sort();
}

const livingFiles = ["AGENTS.md", ...listLivingMarkdown(repoRoot)];
const country = "(?:Indonesia|印度尼西亚|印尼|\\bID\\b)";
const currentMarker = "(?:currently|current|目前(?:是|为)|当前(?:是|为)|现在(?:是|为)|现为|被指定为|designated)";
const coverageLevel = "(?:STANDARD|COMPLETE|标准|完整)";
const coverageMarker = "(?:coverageLevel|coverage level|覆盖等级|覆盖级别)";
const basicFirst = "(?:Basic-first|Basic first|基础优先|Basic 优先)";
const exemptionMarker = "(?:exempt|exemption|免除|免于|豁免|不适用|无需遵循|例外)";
const forbiddenCurrentClaims = [
  /(?:Indonesia|印尼|\bID\b).{0,80}(?:Complete sample|Complete 参考|COMPLETE.*样板|完整样板)/i,
  /(?:Complete sample|Complete 参考|COMPLETE.*样板|完整样板).{0,80}(?:Indonesia|印尼|\bID\b)/i,
  /(?:except|除).{0,40}(?:Indonesia|印尼|\bID\b).{0,40}Basic/i,
  new RegExp(`${country}(?![^\\n]{0,40}(?:没有国家|no country)).{0,40}${currentMarker}.{0,20}${coverageLevel}`, "i"),
  new RegExp(`${country}.{0,40}${coverageMarker}.{0,30}${coverageLevel}`, "i"),
  new RegExp(`${coverageLevel}.{0,40}${currentMarker}.{0,40}${country}`, "i"),
  new RegExp(`${coverageLevel}.{0,40}${coverageMarker}.{0,40}${country}`, "i"),
  new RegExp(`${country}.{0,80}${exemptionMarker}.{0,40}${basicFirst}`, "i"),
  new RegExp(`${basicFirst}.{0,40}${exemptionMarker}.{0,80}${country}`, "i"),
  /indonesia-seed\.md/i,
] as const;

function isForbiddenCurrentClaim(text: string): boolean {
  return forbiddenCurrentClaims.some((pattern) => pattern.test(text));
}

describe("Basic-first living strategy", () => {
  test("scans living Markdown while excluding dated strategy records", () => {
    const historicalFiles = walkMarkdown(join(repoRoot, "docs", "superpowers"))
      .map((path) => relative(repoRoot, path).replaceAll("\\", "/"));
    const excludedFiles = [
      "docs/superpowers/specs/2026-07-11-basic-first-indonesia-migration-design.md",
      "docs/superpowers/plans/2026-07-10-basic-country-collection-plan.md",
    ];

    expect(historicalFiles).toEqual(expect.arrayContaining(excludedFiles));
    expect(livingFiles).not.toEqual(expect.arrayContaining(excludedFiles));
    expect(livingFiles).toContain("docs/product-brief.md");
  });

  test("does not retain current Complete-sample or Basic-exemption claims", () => {
    for (const file of livingFiles) {
      const text = readFileSync(join(repoRoot, file), "utf8");
      expect(isForbiddenCurrentClaim(text)).toBe(false);
    }

    expect(existsSync(join(repoRoot, "docs/indonesia-seed.md"))).toBe(false);
  });

  test.each([
    "Indonesia is currently COMPLETE.",
    "ID coverageLevel is COMPLETE.",
    "Indonesia is currently STANDARD.",
    "印度尼西亚目前是 COMPLETE。",
    "ID 的覆盖等级为 STANDARD。",
    "Indonesia is exempt from Basic-first.",
    "Basic-first exempts Indonesia.",
    "Basic-first 不适用于印尼。",
    "印尼免于 Basic-first。",
  ])("rejects direct current Indonesia/ID policy claim: %s", (claim) => {
    expect(isForbiddenCurrentClaim(claim)).toBe(true);
  });

  test.each([
    "当前没有国家被指定为 STANDARD 或 COMPLETE。",
    "STANDARD and COMPLETE remain future, separately approved upgrades.",
  ])("allows shared policy statement: %s", (claim) => {
    expect(isForbiddenCurrentClaim(claim)).toBe(false);
  });
});
