import { parseBasicProfile, type BasicProfile } from "@navigator/shared-types/basic-profile";

import { loadApprovedBasicCountryPublicationV2 } from "../collection/basic-publication-loader.js";

type ApprovedPublicationProfileLoader = (
  repoRoot: string,
  countryDirectory: string,
) => BasicProfile | null;

const APPROVED_PUBLICATION_PROFILE_LOADERS = Object.freeze([
  loadApprovedV2Profile,
] as const satisfies readonly ApprovedPublicationProfileLoader[]);

export function loadApprovedPreviousBasicProfileVersioned(
  repoRoot: string,
  countryDirectory: string,
): BasicProfile | null {
  try {
    return APPROVED_PUBLICATION_PROFILE_LOADERS[0](repoRoot, countryDirectory);
  } catch {
    throw new Error("approved previous BASIC publication is invalid");
  }
}

function loadApprovedV2Profile(
  repoRoot: string,
  countryDirectory: string,
): BasicProfile | null {
  const publication = loadApprovedBasicCountryPublicationV2(repoRoot, countryDirectory);
  if (!publication.valid) throw new Error("invalid");
  const profileValue = publication.data.canonical.marketOverview.basicProfile;
  if (profileValue === undefined || profileValue === null) return null;
  const profile = parseBasicProfile(profileValue);
  if (profile === null) throw new Error("invalid");
  return profile;
}
