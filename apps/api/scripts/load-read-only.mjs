import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLoopbackBaseUrl,
  assertLoopbackMetricsUrl,
  assertScenarioName,
  parseScenarioFile,
} from "./load-read-only-contract.mjs";
import {
  parseCliArguments,
  prepareArtifactPaths,
  readEnvironmentArtifact,
  resolveArtifactPaths,
  writeArtifactAtomic,
} from "./load-read-only-artifacts.mjs";
import { runLoadScenario } from "./load-read-only-runner.mjs";

export {
  assertLoopbackBaseUrl,
  assertLoopbackMetricsUrl,
  assertOutputPath,
  buildRequestMatrix,
  parsePrometheusProcessMetrics,
  parseScenarioFile,
} from "./load-read-only-contract.mjs";
export { runLoadScenario } from "./load-read-only-runner.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../../..");
const scenarioFilePath = resolve(scriptDirectory, "read-only-load-scenarios.json");

export async function main(argv = process.argv.slice(2)) {
  const cli = parseCliArguments(argv);
  const baseUrl = assertLoopbackBaseUrl(cli.baseUrl);
  const metricsUrl = assertLoopbackMetricsUrl(cli.metricsUrl);
  const scenarioName = assertScenarioName(cli.scenario);
  const paths = resolveArtifactPaths(cli.output, scenarioName, { cwd: process.cwd(), repositoryRoot });
  await prepareArtifactPaths(paths);
  const scenarioRaw = await readFile(scenarioFilePath, "utf8");
  const scenarios = parseScenarioFile(scenarioRaw);
  const scenarioFileSha256 = createHash("sha256").update(scenarioRaw).digest("hex");
  const environment = await readEnvironmentArtifact(paths.environmentPath, scenarioFileSha256);
  const result = await runLoadScenario({
    baseUrl, environment, metricsUrl, scenario: scenarios[scenarioName], scenarioFileSha256, scenarioName,
  });
  await writeArtifactAtomic(paths.outputPath, result);
}

function isEntrypoint() {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
}

if (isEntrypoint()) {
  main().catch((error) => {
    const code = error instanceof Error && /^LOAD_[A-Z0-9_]+$/.test(error.message) ? error.message : "LOAD_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
