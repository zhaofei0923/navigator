import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";

const TEMPORARY_TOKEN_BYTES = 16;
const TEMPORARY_OPEN_FLAGS =
  constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY;

export async function writeJsonArtifact(path, value) {
  const token = randomBytes(TEMPORARY_TOKEN_BYTES).toString("hex");
  const temporaryPath = `${path}.${process.pid}.${token}.tmp`;
  let handle;
  let owned = false;
  try {
    handle = await open(temporaryPath, TEMPORARY_OPEN_FLAGS, 0o600);
    owned = true;
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, path);
    owned = false;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (owned) await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
