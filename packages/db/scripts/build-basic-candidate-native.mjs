import { execFileSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_NAME = "basic-candidate-fs.c";
const OUTPUT_NAME = "basic-candidate-fs.node";
const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY |
  constants.O_NOFOLLOW | constants.O_CLOEXEC;
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC;

if (process.platform !== "linux") {
  throw new Error("Basic candidate native helper build requires Linux");
}

const descriptors = [];
let temporaryDirectory = null;
let temporaryFd = null;
let temporaryOutput = null;
try {
  const packageFd = holdDirectory(PACKAGE_DIRECTORY);
  const sourceDirectoryFd = holdDirectory(childPath(packageFd, "native"));
  const sourcePath = childPath(sourceDirectoryFd, SOURCE_NAME);
  requireRegularFile(sourcePath);

  const executablePath = realpathSync(process.execPath);
  const installationPrefix = dirname(dirname(executablePath));
  const includePath = realpathSync(resolve(installationPrefix, "include", "node"));
  const includeRelative = relative(installationPrefix, includePath);
  if (
    includeRelative === "" || includeRelative.startsWith("..") ||
    resolve(installationPrefix, includeRelative) !== includePath
  ) throw new Error("Node include directory is outside the executable installation");
  const includeFd = holdDirectory(includePath);
  requireRegularFile(childPath(includeFd, "node_api.h"));

  const cacheFd = ensurePrivateDirectory(packageFd, ".cache");
  const outputFd = ensurePrivateDirectory(cacheFd, "native");
  temporaryDirectory = mkdtempSync(`${descriptorPath(outputFd)}/.basic-candidate-fs-`);
  temporaryFd = holdDirectory(temporaryDirectory, 0o700);
  temporaryOutput = childPath(temporaryFd, OUTPUT_NAME);

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
    "-I/proc/self/fd/4",
    "-o",
    `/proc/self/fd/5/${OUTPUT_NAME}`,
    `/proc/self/fd/3/${SOURCE_NAME}`,
  ]);
  execFileSync("cc", compilerArguments, {
    shell: false,
    stdio: ["inherit", "inherit", "inherit", sourceDirectoryFd, includeFd, temporaryFd],
  });
  chmodSync(temporaryOutput, 0o500);
  requireRegularFile(temporaryOutput, 0o500);
  renameSync(temporaryOutput, childPath(outputFd, OUTPUT_NAME));
  temporaryOutput = null;
  fsyncSync(outputFd);
  requireRegularFile(childPath(outputFd, OUTPUT_NAME), 0o500);
} finally {
  let cleanupFailure = false;
  try {
    if (temporaryOutput !== null) unlinkKnownFile(temporaryOutput);
  } catch {
    cleanupFailure = true;
  }
  try {
    if (temporaryFd !== null) closeHeldDescriptor(temporaryFd);
  } catch {
    cleanupFailure = true;
  }
  try {
    if (temporaryDirectory !== null) rmdirSync(temporaryDirectory);
  } catch {
    cleanupFailure = true;
  }
  try {
    closeAllDescriptors();
  } catch {
    cleanupFailure = true;
  }
  if (cleanupFailure) throw new Error("Native build cleanup failed");
}

function holdDirectory(pathname, expectedMode) {
  const descriptor = openSync(pathname, DIRECTORY_FLAGS);
  try {
    const details = fstatSync(descriptor);
    if (!details.isDirectory() || (
      expectedMode !== undefined && (details.mode & 0o777) !== expectedMode
    )) throw new Error("Native build directory is invalid");
  } catch (error) {
    try {
      closeSync(descriptor);
    } catch {
      throw new Error("Native build descriptor close failed");
    }
    throw error;
  }
  descriptors.push(descriptor);
  return descriptor;
}

function ensurePrivateDirectory(parentFd, name) {
  const pathname = childPath(parentFd, name);
  try {
    mkdirSync(pathname, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  return holdDirectory(pathname, 0o700);
}

function requireRegularFile(pathname, expectedMode) {
  const descriptor = openSync(pathname, FILE_FLAGS);
  try {
    const details = fstatSync(descriptor);
    if (!details.isFile() || (
      expectedMode !== undefined && (details.mode & 0o777) !== expectedMode
    )) throw new Error("Native build file is invalid");
  } finally {
    closeSync(descriptor);
  }
}

function unlinkKnownFile(pathname) {
  try {
    unlinkSync(pathname);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}

function closeAllDescriptors() {
  let failure = false;
  for (const descriptor of descriptors.splice(0).reverse()) {
    try {
      closeSync(descriptor);
    } catch {
      failure = true;
    }
  }
  if (failure) throw new Error("Native build descriptor close failed");
}

function closeHeldDescriptor(descriptor) {
  closeSync(descriptor);
  const index = descriptors.indexOf(descriptor);
  if (index >= 0) descriptors.splice(index, 1);
}

function descriptorPath(descriptor) {
  return `/proc/self/fd/${descriptor}`;
}

function childPath(parentFd, name) {
  return `${descriptorPath(parentFd)}/${name}`;
}

function errorCode(error) {
  return error?.code;
}
