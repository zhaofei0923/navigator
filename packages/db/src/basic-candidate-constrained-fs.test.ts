import { constants } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";

import { afterEach, describe, expect, test, vi } from "vitest";

const nativeProbe = vi.hoisted(() => ({
  closeCalls: 0,
  closeFailure: false,
  directory: null as null | Readonly<{
    fd: number;
    dev: bigint;
    ino: bigint;
    created?: boolean;
  }>,
}));

const openProbe = vi.hoisted(() => ({
  duplicatePath: "",
  failDuplicate: false,
  openDuplicates: new Set<unknown>(),
}));

vi.mock("./cli/basic-candidate-native-fs.js", () => ({
  closeBasicCandidateNativeDirectory() {
    nativeProbe.closeCalls += 1;
    if (nativeProbe.closeFailure) throw new Error("SECRET raw close failure");
  },
  createBasicCandidateExclusiveDirectoryNative() {
    return nativeProbe.directory;
  },
  ensureBasicCandidateDirectoryNative() {
    return nativeProbe.directory;
  },
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    async open(
      pathname: Parameters<typeof actual.open>[0],
      flags: Parameters<typeof actual.open>[1],
      mode?: Parameters<typeof actual.open>[2],
    ) {
      if (String(pathname) === openProbe.duplicatePath && openProbe.failDuplicate) {
        throw new Error("SECRET duplicate failure");
      }
      const handle = await actual.open(pathname, flags, mode);
      if (String(pathname) === openProbe.duplicatePath) {
        const close = handle.close.bind(handle);
        openProbe.openDuplicates.add(handle);
        Object.defineProperty(handle, "close", {
          configurable: true,
          value: async () => {
            try {
              await close();
            } finally {
              openProbe.openDuplicates.delete(handle);
            }
          },
        });
      }
      return handle;
    },
  };
});

import {
  closeBasicCandidateHeldDirectories,
  createBasicCandidateExclusiveDirectory,
  ensureBasicCandidateDirectoryChild,
  type BasicCandidateHeldDirectory,
} from "./cli/basic-candidate-constrained-fs.js";
import { closeBasicCandidateHandle } from "./cli/basic-candidate-fs-handles.js";

const roots: string[] = [];

describe("Basic candidate constrained filesystem descriptor lifecycle", () => {
  afterEach(async () => {
    nativeProbe.closeCalls = 0;
    nativeProbe.closeFailure = false;
    nativeProbe.directory = null;
    openProbe.duplicatePath = "";
    openProbe.failDuplicate = false;
    expect(openProbe.openDuplicates.size).toBe(0);
    await Promise.all(roots.splice(0).map((pathname) =>
      rm(pathname, { recursive: true, force: true })
    ));
  });

  test.each(["create", "ensure"] as const)(
    "closes the raw native fd when %s duplication fails",
    async (operation) => {
      const fixture = await heldDirectoryFixture();
      await configureNativeResult(fixture.raw, operation === "ensure");
      openProbe.failDuplicate = true;

      await expect(operation === "create"
        ? createBasicCandidateExclusiveDirectory(fixture.parent, "child", 0o700)
        : ensureBasicCandidateDirectoryChild(fixture.parent, "child", 0o700))
        .rejects.toThrow();

      expect(nativeProbe.closeCalls).toBe(1);
      await closeFixture(fixture);
    },
  );

  test.each(["create", "ensure"] as const)(
    "closes raw and duplicated fds when %s identity validation fails",
    async (operation) => {
      const fixture = await heldDirectoryFixture();
      await configureNativeResult(fixture.raw, operation === "ensure", 1n);

      await expect(operation === "create"
        ? createBasicCandidateExclusiveDirectory(fixture.parent, "child", 0o700)
        : ensureBasicCandidateDirectoryChild(fixture.parent, "child", 0o700))
        .rejects.toThrow();

      expect(nativeProbe.closeCalls).toBe(1);
      expect(openProbe.openDuplicates.size).toBe(0);
      await closeFixture(fixture);
    },
  );

  test.each(["create", "ensure"] as const)(
    "closes the duplicated fd and fails fixed when native %s close fails",
    async (operation) => {
      const fixture = await heldDirectoryFixture();
      await configureNativeResult(fixture.raw, operation === "ensure");
      nativeProbe.closeFailure = true;

      await expect(operation === "create"
        ? createBasicCandidateExclusiveDirectory(fixture.parent, "child", 0o700)
        : ensureBasicCandidateDirectoryChild(fixture.parent, "child", 0o700))
        .rejects.toThrow("basic candidate constrained filesystem is invalid");

      expect(nativeProbe.closeCalls).toBe(1);
      expect(openProbe.openDuplicates.size).toBe(0);
      nativeProbe.closeFailure = false;
      await closeFixture(fixture);
    },
  );

  test("attempts every FileHandle close and surfaces one fixed failure", async () => {
    const attempts: string[] = [];
    const directories = ["first", "second", "third"].map((name) => ({
      handle: {
        async close() {
          attempts.push(name);
          if (name === "second") throw new Error("SECRET close failure");
        },
      } as FileHandle,
      identity: Object.freeze({ dev: 1n, ino: 1n, type: 0o040000n }),
    }));

    await expect(closeBasicCandidateHeldDirectories(directories))
      .rejects.toThrow("basic candidate constrained filesystem is invalid");
    expect(attempts).toEqual(["third", "second", "first"]);
  });

  test("redacts a single FileHandle close failure", async () => {
    const handle = {
      async close() {
        throw new Error("SECRET close path");
      },
    } as unknown as FileHandle;

    await expect(closeBasicCandidateHandle(handle))
      .rejects.toThrow("basic candidate constrained filesystem is invalid");
  });
});

async function heldDirectoryFixture() {
  const root = await mkdtemp("/tmp/basic-candidate-fd-");
  roots.push(root);
  const raw = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
  const parentHandle = await open(root, constants.O_RDONLY | constants.O_DIRECTORY);
  const details = await parentHandle.stat({ bigint: true });
  const parent: BasicCandidateHeldDirectory = Object.freeze({
    handle: parentHandle,
    identity: Object.freeze({
      dev: details.dev,
      ino: details.ino,
      type: details.mode & 0o170000n,
    }),
  });
  return { parent, raw };
}

async function configureNativeResult(
  raw: FileHandle,
  ensured: boolean,
  devOffset = 0n,
): Promise<void> {
  const details = await raw.stat({ bigint: true });
  openProbe.duplicatePath = `/proc/self/fd/${raw.fd}/`;
  nativeProbe.directory = Object.freeze({
    fd: raw.fd,
    dev: details.dev + devOffset,
    ino: details.ino,
    ...(ensured ? { created: true } : {}),
  });
}

async function closeFixture(fixture: Awaited<ReturnType<typeof heldDirectoryFixture>>) {
  await fixture.raw.close();
  await fixture.parent.handle.close();
}
