import { isProxy } from "node:util/types";

import {
  closeBasicCandidateHeldDirectories,
  openBasicCandidateDirectoryChild,
  openBasicCandidateTrustedDirectory,
  readBasicCandidateBoundedRegularFile,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";

export interface BasicCandidateWorkspace {}

type WorkspaceState = Readonly<{
  root: BasicCandidateHeldDirectory;
  descriptorRoot: string;
}>;

const MAX_WORKSPACE_FILE_BYTES = 1024 * 1024;
const WORKSPACES = new WeakMap<object, WorkspaceState>();
const CLOSED_WORKSPACES = new WeakSet<object>();

export async function openBasicCandidateWorkspace(
  pathname: unknown,
): Promise<BasicCandidateWorkspace> {
  let root: BasicCandidateHeldDirectory | null = null;
  try {
    root = await openBasicCandidateTrustedDirectory(pathname);
    await verifyWorkspace(root);
    const capability = Object.freeze(Object.create(null)) as BasicCandidateWorkspace;
    WORKSPACES.set(capability, Object.freeze({
      root,
      descriptorRoot: `/proc/self/fd/${root.handle.fd}/`,
    }));
    root = null;
    return capability;
  } catch {
    throw new Error("basic candidate workspace is invalid");
  } finally {
    await closeBasicCandidateHeldDirectories([root]);
  }
}

export function getBasicCandidateWorkspaceDescriptorRoot(
  workspace: BasicCandidateWorkspace,
): string {
  return requireWorkspaceState(workspace).descriptorRoot;
}

export function getBasicCandidateWorkspaceRootDirectory(
  workspace: BasicCandidateWorkspace,
): BasicCandidateHeldDirectory {
  return requireWorkspaceState(workspace).root;
}

export async function closeBasicCandidateWorkspace(
  workspace: BasicCandidateWorkspace,
): Promise<void> {
  if (typeof workspace !== "object" || workspace === null) invalid();
  const state = WORKSPACES.get(workspace);
  if (state === undefined) invalid();
  if (CLOSED_WORKSPACES.has(workspace)) return;
  CLOSED_WORKSPACES.add(workspace);
  await closeBasicCandidateHeldDirectories([state.root]);
}

function requireWorkspaceState(workspace: unknown): WorkspaceState {
  if (
    typeof workspace !== "object" || workspace === null ||
    CLOSED_WORKSPACES.has(workspace)
  ) invalid();
  return WORKSPACES.get(workspace) ?? invalid();
}

async function verifyWorkspace(root: BasicCandidateHeldDirectory): Promise<void> {
  await readBasicCandidateBoundedRegularFile(
    root,
    "pnpm-workspace.yaml",
    MAX_WORKSPACE_FILE_BYTES,
  );
  const packageJson = await readWorkspaceJson(root, "package.json");
  let packages: BasicCandidateHeldDirectory | null = null;
  let database: BasicCandidateHeldDirectory | null = null;
  try {
    packages = await openBasicCandidateDirectoryChild(root, "packages");
    database = await openBasicCandidateDirectoryChild(packages, "db");
    const databasePackageJson = await readWorkspaceJson(database, "package.json");
    if (
      readDataProperty(packageJson, "name") !== "navigator" ||
      readDataProperty(databasePackageJson, "name") !== "@navigator/db"
    ) invalid();
  } finally {
    await closeBasicCandidateHeldDirectories([database, packages]);
  }
}

async function readWorkspaceJson(
  directory: BasicCandidateHeldDirectory,
  name: string,
): Promise<unknown> {
  const bytes = await readBasicCandidateBoundedRegularFile(
    directory,
    name,
    MAX_WORKSPACE_FILE_BYTES,
  );
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
}

function readDataProperty(value: unknown, name: string): unknown {
  if (
    typeof value !== "object" || value === null || isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, name);
  if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) invalid();
  return descriptor.value;
}

function invalid(): never {
  throw new Error("basic candidate workspace is invalid");
}
