import { lstatSync, realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), ".."),
);

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!isMissingModuleError(error) || !isSafeRelativeJs(specifier)) {
        throw error;
      }

      try {
        const parentPath = readSafeParentPath(context.parentURL);
        const missingJsPath = resolve(dirname(parentPath), specifier);
        assertInsideRepository(missingJsPath);
        assertAbsent(missingJsPath);

        const sourcePath = `${missingJsPath.slice(0, -3)}.ts`;
        assertRegularRepositoryFile(sourcePath);
        return {
          shortCircuit: true,
          url: pathToFileURL(sourcePath).href,
        };
      } catch {
        throw error;
      }
    }
  },
});

function isMissingModuleError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_MODULE_NOT_FOUND"
  );
}

function isSafeRelativeJs(specifier) {
  if (
    typeof specifier !== "string" ||
    (!specifier.startsWith("./") && !specifier.startsWith("../")) ||
    !specifier.endsWith(".js") ||
    specifier.includes("\\") ||
    specifier.includes("?") ||
    specifier.includes("#") ||
    specifier.includes("%") ||
    specifier.includes("\0")
  ) {
    return false;
  }

  const relativePath = specifier.startsWith("./") ? specifier.slice(2) : specifier;
  const segments = relativePath.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== ".",
  );
}

function readSafeParentPath(parentUrl) {
  if (typeof parentUrl !== "string") {
    throw new Error("invalid parent");
  }
  const parsed = new URL(parentUrl);
  if (parsed.protocol !== "file:" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("invalid parent");
  }
  const parentPath = fileURLToPath(parsed);
  assertRegularRepositoryFile(parentPath);
  return parentPath;
}

function assertAbsent(pathname) {
  try {
    lstatSync(pathname);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
  }
  throw new Error("target is not absent");
}

function assertRegularRepositoryFile(pathname) {
  const parts = assertInsideRepository(pathname).split(sep);
  let current = repositoryRoot;

  for (const [index, part] of parts.entries()) {
    current = resolve(current, part);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error("symlink is not allowed");
    }
    const final = index === parts.length - 1;
    if ((final && !stat.isFile()) || (!final && !stat.isDirectory())) {
      throw new Error("path type is not allowed");
    }
  }
}

function assertInsideRepository(pathname) {
  const fromRoot = relative(repositoryRoot, pathname);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("path is outside repository");
  }
  return fromRoot;
}
