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
const forbiddenCurrentClaims = [
  /(?:Indonesia|印尼|\bID\b).{0,80}(?:Complete sample|Complete 参考|COMPLETE.*样板|完整样板)/i,
  /(?:Complete sample|Complete 参考|COMPLETE.*样板|完整样板).{0,80}(?:Indonesia|印尼|\bID\b)/i,
  /(?:except|除).{0,40}(?:Indonesia|印尼|\bID\b).{0,40}Basic/i,
  /indonesia-seed\.md/i,
] as const;

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
      for (const pattern of forbiddenCurrentClaims) expect(text).not.toMatch(pattern);
    }

    expect(existsSync(join(repoRoot, "docs/indonesia-seed.md"))).toBe(false);
  });
});
