import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BasicCollectionAuditBundle } from "./basic-collection-contracts.js";
import { validateBasicCollectionAuditBundle } from "./basic-collection-validator.js";
import {
  SAFE_COUNTRY_DIRECTORY,
  SAFE_RUN_ID,
} from "../seed/basic-country-validation-utils.js";

export function loadBasicCollectionAuditBundle(
  repoRoot: string,
  countryDirectory: string,
  runId: string,
): BasicCollectionAuditBundle {
  if (!SAFE_COUNTRY_DIRECTORY.test(countryDirectory)) {
    throw new Error("countryDirectory must be a safe slug");
  }
  if (!SAFE_RUN_ID.test(runId)) {
    throw new Error("runId must be a safe run id");
  }

  const stagingDirectory = join(
    repoRoot,
    "data",
    "staging",
    countryDirectory,
    runId,
  );
  const result = validateBasicCollectionAuditBundle({
    countryDirectory,
    runId,
    sourceRegister: readJson(join(stagingDirectory, "source-register.json")),
    extractedFacts: readJson(join(stagingDirectory, "extracted-facts.json")),
    marketOverviewDraft: readJson(
      join(stagingDirectory, "market-overview.draft.json"),
    ),
    reviewReport: readJson(join(stagingDirectory, "review-report.json")),
  });

  if (!result.valid) {
    throw new Error(result.errors.join("\n"));
  }

  return result.data;
}

function readJson(pathname: string): unknown {
  try {
    return JSON.parse(readFileSync(pathname, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${pathname}: ${message}`);
  }
}
