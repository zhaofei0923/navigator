import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, test } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cacheRoot = join(repositoryRoot, "packages/db/.cache");
const hookPath = join(repositoryRoot, "scripts/node-ts-source-hook.mjs");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("repository TypeScript source hook", () => {
  test("maps one missing relative .js import to a regular .ts source", async () => {
    const root = await createRepositoryFixture();
    await writeFile(join(root, "target.ts"), "export const marker = 'typescript';\n");

    const result = await runImport(root, "./target.js");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("typescript");
  });

  test("preserves normal resolution when the .js target exists", async () => {
    const root = await createRepositoryFixture();
    await writeFile(join(root, "target.js"), "export const marker = 'javascript';\n");
    await writeFile(join(root, "target.ts"), "export const marker = 'typescript';\n");

    const result = await runImport(root, "./target.js");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("javascript");
  });

  test.each([
    ["query", "./target.js?mode=ts"],
    ["fragment", "./target.js#source"],
    ["unsupported extension", "./target.mjs"],
    ["bare specifier", "target.js"],
  ])("rejects an unsupported %s fallback", async (_label, specifier) => {
    const root = await createRepositoryFixture();
    await writeFile(join(root, "target.ts"), "export const marker = 'unsafe';\n");

    const result = await runImport(root, specifier);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });

  test("resolves a normalized parent import only when it stays in the repository", async () => {
    const root = await createRepositoryFixture();
    const child = join(root, "child");
    await mkdir(child);
    await writeFile(join(root, "target.ts"), "export const marker = 'inside';\n");

    const result = await runImport(child, "../target.js");

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("inside");
  });

  test("loads the current candidate composition graph", () => {
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        hookPath,
        "--input-type=module",
        "-e",
        "const module = await import('./packages/db/src/cli/basic-candidate-composition.ts'); if (typeof module.composeBasicCountryCandidate !== 'function') process.exit(1);",
      ],
      { cwd: repositoryRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
  });

  test("rejects file URLs and relative targets outside the repository", async () => {
    const root = await createRepositoryFixture();
    const outsideRoot = await mkdtemp(join(tmpdir(), "navigator-hook-outside-"));
    temporaryRoots.push(outsideRoot);
    const outsideTs = join(outsideRoot, "outside.ts");
    await writeFile(outsideTs, "export const marker = 'unsafe';\n");
    const outsideJs = outsideTs.slice(0, -3) + ".js";
    const outsideRelative = relative(root, outsideJs).replaceAll("\\", "/");

    for (const specifier of [outsideRelative, pathToFileURL(outsideJs).href]) {
      const result = await runImport(root, specifier);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
    }
  });

  test("rejects symlinked files, symlinked ancestors, and non-files", async () => {
    const root = await createRepositoryFixture();
    await writeFile(join(root, "real.ts"), "export const marker = 'unsafe';\n");
    await symlink("real.ts", join(root, "linked.ts"));
    await mkdir(join(root, "target.ts"));
    await mkdir(join(root, "real-directory"));
    await writeFile(
      join(root, "real-directory/child.ts"),
      "export const marker = 'unsafe';\n",
    );
    await symlink("real-directory", join(root, "linked-directory"));

    for (const specifier of [
      "./linked.js",
      "./target.js",
      "./linked-directory/child.js",
    ]) {
      const result = await runImport(root, specifier);
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
    }
  });
});

async function createRepositoryFixture(): Promise<string> {
  await mkdir(cacheRoot, { recursive: true });
  const root = await mkdtemp(join(cacheRoot, "node-ts-source-hook-"));
  temporaryRoots.push(root);
  return root;
}

async function runImport(root: string, specifier: string) {
  const entrypoint = join(root, "entry.ts");
  await writeFile(
    entrypoint,
    `import { marker } from ${JSON.stringify(specifier)}; process.stdout.write(marker);\n`,
  );
  return spawnSync(process.execPath, ["--import", hookPath, entrypoint], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}
