import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, test } from "vitest";
import { resolve } from "../scripts/node-ts-source-loader.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolvePath(testDirectory, "..");
const loaderPath = resolvePath(repositoryRoot, "scripts/node-ts-source-loader.mjs");

describe("repository TypeScript source loader", () => {
  test("starts the real DB TypeScript source graph under Node 24", () => {
    const result = spawnSync(
      "node",
      [
        "--experimental-transform-types",
        "--experimental-loader",
        loaderPath,
        "--input-type=module",
        "-e",
        "const db = await import('./packages/db/src/index.ts'); if (typeof db.runBasicHermesDiscovery !== 'function') process.exit(1)",
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          PATH: "/home/kevin/.nvm/versions/node/v24.18.0/bin:/usr/local/bin:/usr/bin:/bin",
        },
        encoding: "utf8",
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  });

  test("rejects a relative JavaScript fallback that escapes the repository", async () => {
    const parentPath = fileURLToPath(import.meta.url);
    const parentURL = pathToFileURL(parentPath).href;
    const outsideDirectory = await mkdtemp(join(tmpdir(), "node-ts-source-loader-"));
    const outsidePath = join(outsideDirectory, "outside.ts");
    const resolutionError = Object.assign(new Error("module not found"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    try {
      await writeFile(outsidePath, "export const outside = true;\n");
      const outsideSpecifier = `${relative(dirname(parentPath), outsidePath).replaceAll("\\", "/").replace(/\.ts$/, ".js")}`;

      await expect(
        resolve(
          outsideSpecifier,
          { parentURL },
          async () => {
            throw resolutionError;
          },
        ),
      ).rejects.toBe(resolutionError);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  test("preserves the original error when the in-repository TypeScript counterpart is missing", async () => {
    const parentURL = pathToFileURL(fileURLToPath(import.meta.url)).href;
    const resolutionError = Object.assign(new Error("module not found"), {
      code: "ERR_MODULE_NOT_FOUND",
    });

    await expect(
      resolve(
        "./does-not-exist.js",
        { parentURL },
        async () => {
          throw resolutionError;
        },
      ),
    ).rejects.toBe(resolutionError);
  });
});
