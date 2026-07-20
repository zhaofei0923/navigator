import type { BasicProfile } from "@navigator/shared-types/basic-profile";

import {
  closeBasicCandidateHeldDirectories,
  openBasicCandidateDirectoryChild,
  requireBasicCandidateHeldChild,
  type BasicCandidateHeldDirectory,
} from "./basic-candidate-constrained-fs.js";
import {
  getActiveBasicPublicationSnapshotState,
  locateActiveBasicPublicationSnapshot,
} from "./basic-active-publication-snapshot.js";

export interface BasicReviewPreviousProfileSnapshot {
  readonly profile: BasicProfile | null;
  readonly verify: () => Promise<void>;
  readonly close: () => Promise<void>;
}

export async function snapshotBasicReviewPreviousProfile(
  root: BasicCandidateHeldDirectory,
  countryDirectory: string,
): Promise<BasicReviewPreviousProfileSnapshot> {
  let data: BasicCandidateHeldDirectory | null = null;
  let country: BasicCandidateHeldDirectory | null = null;
  try {
    data = await openBasicCandidateDirectoryChild(root, "data");
    try {
      country = await openBasicCandidateDirectoryChild(data, countryDirectory);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
      const heldData = data;
      data = null;
      return absentSnapshot(root, heldData, countryDirectory);
    }
  } catch {
    invalid();
  } finally {
    await closeBasicCandidateHeldDirectories([country, data]);
  }

  try {
    const active = await locateActiveBasicPublicationSnapshot(root, countryDirectory);
    const state = getActiveBasicPublicationSnapshotState(active);
    return Object.freeze({
      profile: state.profile,
      async verify(): Promise<void> {
        try {
          await state.verify();
        } catch {
          invalid();
        }
      },
      close: active.close,
    });
  } catch {
    invalid();
  }
}

function absentSnapshot(
  root: BasicCandidateHeldDirectory,
  data: BasicCandidateHeldDirectory,
  countryDirectory: string,
): BasicReviewPreviousProfileSnapshot {
  let closed = false;
  return Object.freeze({
    profile: null,
    async verify(): Promise<void> {
      try {
        if (closed) invalid();
        await requireBasicCandidateHeldChild(root, "data", data);
        let probe: BasicCandidateHeldDirectory | null = null;
        try {
          probe = await openBasicCandidateDirectoryChild(data, countryDirectory);
        } catch (error) {
          if (errorCode(error) === "ENOENT") return;
          invalid();
        } finally {
          await closeBasicCandidateHeldDirectories([probe]);
        }
        invalid();
      } catch {
        invalid();
      }
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await closeBasicCandidateHeldDirectories([data]);
    },
  });
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code;
}

function invalid(): never {
  throw new Error("previous BASIC publication snapshot is invalid");
}
