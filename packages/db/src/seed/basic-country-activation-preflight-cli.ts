import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  preflightBasicCountryActivation,
  type BasicActivationCountPort,
  type BasicActivationModel,
  type BasicActivationScope,
  type BasicCountryActivationPreflightResult,
} from "./basic-country-activation-preflight.js";

const TARGET_COUNTRY_CODE = "ID";
const CLEANUP_TASK = "OPS-DATA-ID-BASIC-CLEANUP";
const USAGE = "Usage: pnpm --filter @navigator/db run preflight:basic-activation -- ID";
const PUBLISHED_REVIEW_STATUS = "published" as const;
const UNVERIFIED_CREDIBILITY = "UNVERIFIED" as const;

type BasicCountryActivationCliMode = "help" | "run" | "invalid";

interface BasicActivationWhere {
  readonly countryCode: string;
  readonly reviewStatus?: typeof PUBLISHED_REVIEW_STATUS;
  readonly aiUsable?: boolean;
  readonly credibility?: { readonly not: typeof UNVERIFIED_CREDIBILITY };
}

export interface BasicCountryActivationPreflightCliDependencies {
  readonly createClient: () => PrismaClient;
  readonly preflight: typeof preflightBasicCountryActivation;
  readonly writeStdout: (output: string) => void;
  readonly writeStderr: (output: string) => void;
}

export function classifyBasicCountryActivationPreflightArgs(
  args: readonly string[],
): BasicCountryActivationCliMode {
  if (args.length === 2 && args[0] === "--" && args[1] === "--help") {
    return "help";
  }
  if (
    args.length === 2 &&
    args[0] === "--" &&
    args[1] === TARGET_COUNTRY_CODE
  ) {
    return "run";
  }
  return "invalid";
}

function createWhere(
  scope: BasicActivationScope,
  countryCode: string,
): BasicActivationWhere {
  if (scope === "all") {
    return { countryCode };
  }
  if (scope === "published") {
    return { countryCode, reviewStatus: PUBLISHED_REVIEW_STATUS };
  }
  return {
    countryCode,
    reviewStatus: PUBLISHED_REVIEW_STATUS,
    aiUsable: true,
    credibility: { not: UNVERIFIED_CREDIBILITY },
  };
}

export function createPrismaBasicActivationCountPort(
  prismaClient: PrismaClient,
): BasicActivationCountPort {
  return Object.freeze({
    async count(
      model: BasicActivationModel,
      scope: BasicActivationScope,
      countryCode: string,
    ): Promise<number> {
      const where = createWhere(scope, countryCode);

      switch (model) {
        case "marketOverview":
          return prismaClient.marketOverview.count({ where });
        case "policy":
          return prismaClient.policy.count({ where });
        case "risk":
          return prismaClient.risk.count({ where });
        case "opportunity":
          return prismaClient.opportunity.count({ where });
        case "project":
          return prismaClient.project.count({ where });
        case "partner":
          return prismaClient.partner.count({ where });
        case "chineseCompany":
          return prismaClient.chineseCompany.count({ where });
        case "entryStrategy":
          return prismaClient.entryStrategy.count({ where });
        case "report":
          return prismaClient.report.count({ where });
        case "knowledgeChunk":
          return prismaClient.knowledgeChunk.count({ where });
      }
    },
  });
}

export function createIdBasicActivationOperatorSummary(
  result: BasicCountryActivationPreflightResult,
): BasicCountryActivationPreflightResult | Readonly<
  BasicCountryActivationPreflightResult & { nextTask: typeof CLEANUP_TASK }
> {
  if (
    result.countryCode === TARGET_COUNTRY_CODE &&
    result.blockerCode === "LEGACY_COUNTRY_DATA_PRESENT"
  ) {
    return Object.freeze({ ...result, nextTask: CLEANUP_TASK });
  }
  return result;
}

function createLifecycleFailureSummary(): BasicCountryActivationPreflightResult {
  return Object.freeze({
    countryCode: TARGET_COUNTRY_CODE,
    activation: "blocked",
    blockerCode: "PREFLIGHT_QUERY_FAILED",
    cleanupRequired: false,
    valid: false,
    errors: Object.freeze(["PREFLIGHT_LIFECYCLE_FAILED"]),
    counts: null,
  });
}

export async function runBasicCountryActivationPreflightCli(
  args: readonly string[],
  dependencies: BasicCountryActivationPreflightCliDependencies,
): Promise<number> {
  const mode = classifyBasicCountryActivationPreflightArgs(args);
  if (mode === "help") {
    dependencies.writeStdout(`${USAGE}\n`);
    return 0;
  }
  if (mode === "invalid") {
    dependencies.writeStderr(
      `${JSON.stringify({ error: "INVALID_ARGUMENTS", usage: USAGE })}\n`,
    );
    return 2;
  }

  let prismaClient: PrismaClient;
  try {
    prismaClient = dependencies.createClient();
  } catch {
    dependencies.writeStderr(`${JSON.stringify(createLifecycleFailureSummary())}\n`);
    return 1;
  }

  let result: BasicCountryActivationPreflightResult | null = null;
  let preflightFailed = false;
  let disconnectFailed = false;
  try {
    result = await dependencies.preflight(
      TARGET_COUNTRY_CODE,
      createPrismaBasicActivationCountPort(prismaClient),
    );
  } catch {
    preflightFailed = true;
  } finally {
    try {
      await prismaClient.$disconnect();
    } catch {
      disconnectFailed = true;
    }
  }

  if (preflightFailed || disconnectFailed || result === null) {
    dependencies.writeStderr(`${JSON.stringify(createLifecycleFailureSummary())}\n`);
    return 1;
  }

  dependencies.writeStdout(
    `${JSON.stringify(createIdBasicActivationOperatorSummary(result))}\n`,
  );
  return result.activation === "ready" && result.valid ? 0 : 1;
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(resolve(entrypoint)).href
) {
  process.exitCode = await runBasicCountryActivationPreflightCli(
    process.argv.slice(2),
    {
      createClient: () => new PrismaClient(),
      preflight: preflightBasicCountryActivation,
      writeStdout: (output) => process.stdout.write(output),
      writeStderr: (output) => process.stderr.write(output),
    },
  );
}
