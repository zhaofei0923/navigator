import { execFileSync } from "node:child_process";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_PATH = join(PACKAGE_DIRECTORY, "native", "basic-candidate-fs.c");
const OUTPUT_DIRECTORY = join(PACKAGE_DIRECTORY, ".cache", "native");
const OUTPUT_PATH = join(OUTPUT_DIRECTORY, "basic-candidate-fs.node");

if (process.platform !== "linux") {
  throw new Error("Basic candidate native helper build requires Linux");
}

const executablePath = await realpath(process.execPath);
const installationPrefix = dirname(dirname(executablePath));
const includePath = await realpath(join(installationPrefix, "include", "node"));
const includeRelative = relative(installationPrefix, includePath);
if (includeRelative === "" || includeRelative.startsWith("..") || resolve(
  installationPrefix,
  includeRelative,
) !== includePath) {
  throw new Error("Node include directory is outside the executable installation");
}
await requireRegularNonSymlink(join(includePath, "node_api.h"));
await requireRegularNonSymlink(SOURCE_PATH);

await mkdir(OUTPUT_DIRECTORY, { recursive: true, mode: 0o700 });
await chmod(OUTPUT_DIRECTORY, 0o700);
const temporaryDirectory = await mkdtemp(join(OUTPUT_DIRECTORY, ".basic-candidate-fs-"));
const temporaryOutput = join(temporaryDirectory, "basic-candidate-fs.node");

try {
  const compilerArguments = Object.freeze([
    "-std=c11",
    "-O2",
    "-fPIC",
    "-fvisibility=hidden",
    "-fno-ident",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-Wpedantic",
    "-Wconversion",
    "-Wsign-conversion",
    "-Wformat=2",
    "-shared",
    "-Wl,-z,relro,-z,now,-z,noexecstack",
    "-Wl,--build-id=none",
    `-I${includePath}`,
    "-o",
    temporaryOutput,
    SOURCE_PATH,
  ]);
  execFileSync("cc", compilerArguments, {
    shell: false,
    stdio: "inherit",
  });
  await chmod(temporaryOutput, 0o500);
  await requireRegularNonSymlink(temporaryOutput, 0o500);
  await rename(temporaryOutput, OUTPUT_PATH);
  await syncDirectory(OUTPUT_DIRECTORY);
  await requireRegularNonSymlink(OUTPUT_PATH, 0o500);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

async function requireRegularNonSymlink(pathname, expectedMode) {
  const details = await lstat(pathname);
  if (details.isSymbolicLink() || !details.isFile()) {
    throw new Error(`Expected a regular non-symlink file: ${pathname}`);
  }
  if (expectedMode !== undefined && (details.mode & 0o777) !== expectedMode) {
    throw new Error(`Unexpected native helper mode: ${pathname}`);
  }
}

async function syncDirectory(pathname) {
  const handle = await open(pathname, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
