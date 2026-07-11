import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  type FileHandle,
} from "node:fs/promises";

import {
  BASIC_COUNTRY_CANDIDATE_ARTIFACTS,
  type BasicCountryCandidateFilesystem,
} from "./basic-country-candidate-contracts.js";
import { loadBasicCollectionAuditBundle } from "./basic-collection-loader.js";
import type { runBasicOfflineDryRun } from "./basic-offline-dry-run.js";

type CandidateArtifacts = NonNullable<Awaited<ReturnType<typeof runBasicOfflineDryRun>>["artifacts"]>;
type PackageResult = { ok: true } | { ok: false; code: "AUDIT_INVALID" | "OUTPUT_REJECTED" };
interface PinnedDirectory { handle: FileHandle; path: string; dev: number; ino: number }

export const BASIC_COUNTRY_CANDIDATE_FILESYSTEM = Object.freeze({
  async run(_operation, action) { await action(); },
} satisfies BasicCountryCandidateFilesystem);

export async function writeCandidatePackage(input: {
  outputRoot: string;
  countryDirectory: string;
  runId: string;
  artifacts: CandidateArtifacts;
  filesystem: BasicCountryCandidateFilesystem;
}): Promise<PackageResult> {
  const pins: PinnedDirectory[] = [];
  let root: PinnedDirectory | null = null;
  let privateRoot: PinnedDirectory | null = null;
  let visibleData: PinnedDirectory | null = null;
  let visibleStaging: PinnedDirectory | null = null;
  let visibleCountry: PinnedDirectory | null = null;
  let targetVisible = false;
  let code: "AUDIT_INVALID" | "OUTPUT_REJECTED" = "OUTPUT_REJECTED";
  const privateName = `.candidate-${randomUUID()}`;
  try {
    root = await pinDirectory(input.outputRoot);
    pins.push(root);
    await assertRoot(root, input.outputRoot);
    privateRoot = await createChild(root, privateName, "create-private-root", input.filesystem, input.outputRoot);
    pins.push(privateRoot);
    const privateData = await createChild(privateRoot, "data", "create-private-data", input.filesystem, input.outputRoot, root);
    pins.push(privateData);
    const privateStaging = await createChild(privateData, "staging", "create-private-staging", input.filesystem, input.outputRoot, root);
    pins.push(privateStaging);
    const privateCountry = await createChild(privateStaging, input.countryDirectory, "create-private-country", input.filesystem, input.outputRoot, root);
    pins.push(privateCountry);
    const privateTarget = await createChild(privateCountry, input.runId, "create-private-target", input.filesystem, input.outputRoot, root);
    pins.push(privateTarget);
    for (const name of BASIC_COUNTRY_CANDIDATE_ARTIFACTS) {
      await checkedRun(input.filesystem, `write-${name}`, [root, privateRoot, privateData, privateStaging, privateCountry, privateTarget], async () => {
        const file = await open(`${privateTarget.path}/${name}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { await file.writeFile(`${JSON.stringify(input.artifacts[name], null, 2)}\n`); await file.sync(); }
        finally { await file.close(); }
      }, input.outputRoot);
    }
    code = "AUDIT_INVALID";
    await checkedRun(input.filesystem, "validate-private", [root, privateRoot, privateTarget], async () => {
      await validateCompleteBundle(privateRoot!.path, input.countryDirectory, input.runId, privateTarget!.path);
    }, input.outputRoot);
    code = "OUTPUT_REJECTED";
    visibleData = await createChild(root, "data", "create-visible-data", input.filesystem, input.outputRoot);
    pins.push(visibleData);
    visibleStaging = await createChild(visibleData, "staging", "create-visible-staging", input.filesystem, input.outputRoot, root);
    pins.push(visibleStaging);
    visibleCountry = await createChild(visibleStaging, input.countryDirectory, "create-visible-country", input.filesystem, input.outputRoot, root);
    pins.push(visibleCountry);
    await checkedRun(input.filesystem, "create-visible-target", [root, visibleData, visibleStaging, visibleCountry], async () => {
      if (await exists(`${visibleCountry!.path}/${input.runId}`)) throw new Error("target exists");
    }, input.outputRoot);
    await assertVisibleChain(input.outputRoot, [root, visibleData, visibleStaging, visibleCountry]);
    await checkedRun(input.filesystem, "publish-target", [root, privateCountry, visibleCountry], async () => {
      await rename(`${privateCountry.path}/${input.runId}`, `${visibleCountry!.path}/${input.runId}`);
      targetVisible = true;
    }, input.outputRoot);
    await checkedRun(input.filesystem, "validate-published", [root, visibleData, visibleStaging, visibleCountry], async () => {
      await assertVisibleChain(input.outputRoot, [root!, visibleData!, visibleStaging!, visibleCountry!]);
      const visibleTarget = await pinDirectory(`${input.outputRoot}/data/staging/${input.countryDirectory}/${input.runId}`);
      try { await assertSame(visibleTarget, privateTarget); await assertArtifactFiles(visibleTarget.path); }
      finally { await visibleTarget.handle.close(); }
    }, input.outputRoot);
    await checkedRun(input.filesystem, "cleanup-private", [root, privateRoot], async () => {
      await rm(`${root!.path}/${privateName}`, { recursive: true });
    }, input.outputRoot);
    privateRoot = null;
    await assertVisibleChain(input.outputRoot, [root, visibleData, visibleStaging, visibleCountry]);
    return { ok: true };
  } catch {
    const cleaned = await rollback(input, root, privateName, visibleData, targetVisible);
    return { ok: false, code: cleaned ? code : "OUTPUT_REJECTED" };
  } finally {
    await Promise.allSettled(pins.map(({ handle }) => handle.close()));
  }
}

async function createChild(
  parent: PinnedDirectory,
  name: string,
  operation: Parameters<BasicCountryCandidateFilesystem["run"]>[0],
  filesystem: BasicCountryCandidateFilesystem,
  outputRoot: string,
  root = parent,
): Promise<PinnedDirectory> {
  const path = `${parent.path}/${name}`;
  await checkedRun(filesystem, operation, [root, parent], async () => {
    if (await exists(path)) throw new Error("descendant exists");
    await mkdir(path, { mode: 0o700 });
  }, outputRoot);
  try {
    const child = await pinDirectory(path);
    const childNames = await readdir(child.path);
    const childStat = await child.handle.stat();
    if ((childStat.mode & 0o777) !== 0o700 || childNames.length !== 0) {
      await child.handle.close();
      throw new Error("private descendant invalid");
    }
    return child;
  } catch (error) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

async function checkedRun(
  filesystem: BasicCountryCandidateFilesystem,
  operation: Parameters<BasicCountryCandidateFilesystem["run"]>[0],
  pins: readonly PinnedDirectory[],
  action: () => Promise<void>,
  outputRoot: string,
): Promise<void> {
  await assertPins(pins);
  await assertRoot(pins[0]!, outputRoot);
  await filesystem.run(operation, action);
  await assertPins(pins);
  await assertRoot(pins[0]!, outputRoot);
}

async function pinDirectory(path: string): Promise<PinnedDirectory> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isDirectory()) throw new Error("not directory");
    return { handle, path: `/proc/self/fd/${handle.fd}`, dev: stat.dev, ino: stat.ino };
  } catch (error) { await handle.close(); throw error; }
}

async function assertPins(pins: readonly PinnedDirectory[]): Promise<void> {
  for (const pin of pins) {
    const stat = await pin.handle.stat();
    if (!stat.isDirectory() || stat.dev !== pin.dev || stat.ino !== pin.ino) throw new Error("directory identity changed");
  }
}

async function assertRoot(root: PinnedDirectory, outputRoot: string): Promise<void> {
  const stat = await lstat(outputRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== root.dev || stat.ino !== root.ino) throw new Error("output root changed");
}

async function assertVisibleChain(outputRoot: string, pins: readonly PinnedDirectory[]): Promise<void> {
  const names = [outputRoot, `${outputRoot}/data`, `${outputRoot}/data/staging`, `${outputRoot}/data/staging/${await basenameOf(pins[3]!)}`];
  for (const [index, path] of names.entries()) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== pins[index]!.dev || stat.ino !== pins[index]!.ino) throw new Error("visible chain changed");
  }
}

async function basenameOf(pin: PinnedDirectory): Promise<string> {
  const link = await import("node:fs/promises").then(({ readlink }) => readlink(pin.path));
  return link.split("/").at(-1)!;
}

async function validateCompleteBundle(root: string, country: string, runId: string, target: string): Promise<void> {
  await assertArtifactFiles(target);
  const bundle = loadBasicCollectionAuditBundle(root, country, runId);
  if (bundle.reviewReport.humanDecision !== null || bundle.reviewReport.status !== "ready-for-human-review" ||
    bundle.reviewReport.publicationRecommendation !== "request-human-review") throw new Error("round trip invalid");
  await assertArtifactFiles(target);
}

async function assertArtifactFiles(target: string): Promise<void> {
  const names = (await readdir(target)).sort();
  if (names.length !== BASIC_COUNTRY_CANDIDATE_ARTIFACTS.length ||
    !BASIC_COUNTRY_CANDIDATE_ARTIFACTS.every((name) => names.includes(name))) throw new Error("artifact set invalid");
  for (const name of names) {
    const stat = await lstat(`${target}/${name}`);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600) throw new Error("artifact file invalid");
  }
}

async function rollback(
  input: { outputRoot: string; runId: string; filesystem: BasicCountryCandidateFilesystem },
  root: PinnedDirectory | null,
  privateName: string,
  visibleData: PinnedDirectory | null,
  targetVisible: boolean,
): Promise<boolean> {
  if (root === null) return false;
  let clean = true;
  if (visibleData !== null || targetVisible) clean = await cleanup(input.filesystem, "cleanup-visible", `${root.path}/data`) && clean;
  clean = await cleanup(input.filesystem, "cleanup-private", `${root.path}/${privateName}`) && clean;
  try {
    const names = await readdir(root.path);
    if (names.some((name) => name === "data" || name.startsWith(".candidate-"))) clean = false;
  } catch { clean = false; }
  return clean;
}

async function cleanup(filesystem: BasicCountryCandidateFilesystem, operation: "cleanup-private" | "cleanup-visible", path: string): Promise<boolean> {
  try { await filesystem.run(operation, async () => { await rm(path, { recursive: true, force: true }); }); return true; }
  catch { try { await rm(path, { recursive: true, force: true }); } catch { return false; } return false; }
}

async function assertSame(left: PinnedDirectory, right: PinnedDirectory): Promise<void> {
  if (left.dev !== right.dev || left.ino !== right.ino) throw new Error("target identity changed");
}

async function exists(path: string): Promise<boolean> {
  return await lstat(path).then(() => true, (error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false;
    throw error;
  });
}
