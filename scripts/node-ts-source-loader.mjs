import { access, realpath } from "node:fs/promises";
import { dirname, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryPrefix = `${await realpath(repositoryRoot)}${sep}`;

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" ||
      !specifier.startsWith(".") ||
      !specifier.endsWith(".js") ||
      typeof context.parentURL !== "string" ||
      !context.parentURL.startsWith("file:")
    ) {
      throw error;
    }

    const parentPath = await realpath(fileURLToPath(context.parentURL));
    if (!parentPath.startsWith(repositoryPrefix)) throw error;

    const candidate = new URL(`${specifier.slice(0, -3)}.ts`, context.parentURL);
    const candidatePath = await realpath(fileURLToPath(candidate));
    if (!candidatePath.startsWith(repositoryPrefix)) throw error;

    await access(candidatePath);
    return { shortCircuit: true, url: pathToFileURL(candidatePath).href };
  }
}
