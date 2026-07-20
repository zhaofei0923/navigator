import { parseBasicProfile, type BasicProfile } from "@navigator/shared-types/basic-profile";

import { loadApprovedBasicCountryPublicationVersioned } from "../collection/basic-publication-versioned-loader.js";

export function loadApprovedPreviousBasicProfileVersioned(
  repoRoot: string,
  countryDirectory: string,
): BasicProfile | null {
  try {
    return loadApprovedProfile(repoRoot, countryDirectory);
  } catch {
    throw new Error("approved previous BASIC publication is invalid");
  }
}

function loadApprovedProfile(
  repoRoot: string,
  countryDirectory: string,
): BasicProfile | null {
  const publication = loadApprovedBasicCountryPublicationVersioned(
    repoRoot,
    countryDirectory,
  );
  if (!publication.valid) throw new Error("invalid");
  const profileValue = publication.data.canonical.marketOverview.basicProfile;
  if (profileValue === undefined || profileValue === null) return null;
  const profile = parseBasicProfile(profileValue);
  if (profile === null) throw new Error("invalid");
  return profile;
}
