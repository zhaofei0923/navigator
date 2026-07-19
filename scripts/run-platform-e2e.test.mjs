import assert from "node:assert/strict";
import { spawn as spawnChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import * as orchestrator from "./run-platform-e2e.mjs";

const { runPlatformE2E } = orchestrator;
const SAFE_DATABASE_URL =
  "postgresql://navigator_test:navigator_test_only@127.0.0.1:5432/navigator_platform_db_1_test";

test("rejects an unsafe external DATABASE_URL before any side effect", async () => {
  const fake = createFakeDependencies();

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {
        DATABASE_URL:
          "postgresql://credential-marker@database.example/navigator_platform_db_1_test",
      },
    }),
    { message: "PLATFORM_E2E_DATABASE_URL_REJECTED" },
  );

  assert.deepEqual(fake.events, []);
});

test("rejects a normalized-but-not-literal expanded IPv6 DATABASE_URL before side effects", async () => {
  const fake = createFakeDependencies();

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {
        DATABASE_URL:
          "postgresql://navigator_test:navigator_test_only@[0:0:0:0:0:0:0:1]:5432/navigator_platform_db_1_test",
      },
    }),
    { message: "PLATFORM_E2E_DATABASE_URL_REJECTED" },
  );

  assert.deepEqual(fake.events, []);
});

test("accepts only the two literal loopback authority forms", async () => {
  for (const host of ["127.0.0.1", "[::1]"]) {
    const fake = createFakeDependencies({
      fetchResponses: [healthReadyResponse(), webReadyResponse()],
    });

    await runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {
        DATABASE_URL:
          `postgresql://navigator_test:navigator_test_only@${host}:5432/navigator_platform_db_1_test`,
      },
      readinessAttempts: 1,
    });

    assert.deepEqual(fake.startedServerLabels, ["api", "web"]);
  }
});

test("probes the root readiness endpoint before starting Web and never probes countries", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse(), webReadyResponse()],
  });

  await runPlatformE2E({
    dependencies: fake.dependencies,
    environment: { DATABASE_URL: SAFE_DATABASE_URL },
    readinessAttempts: 1,
  });

  const fetchUrls = fake.events
    .filter(({ kind }) => kind === "fetch")
    .map(({ url }) => url);
  assert.deepEqual(fetchUrls, [
    "http://127.0.0.1:3100/health/ready",
    "http://127.0.0.1:3000/en",
  ]);
  assert.equal(fetchUrls.some((url) => url.includes("/api/v1/countries")), false);
  assert.deepEqual(fake.startedServerLabels, ["api", "web"]);
});

test("exports a client watchdog longer than both default runtime bounds", () => {
  assert.equal(
    orchestrator.PLATFORM_E2E_DEFAULT_READINESS_REQUEST_TIMEOUT_MS,
    3_000,
  );
});

test("refuses an existing fixed-name container without creating or stopping it", async () => {
  const fake = createFakeDependencies({ existingContainerId: "unknown-container" });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {},
    }),
    { message: "PLATFORM_E2E_CONTAINER_ALREADY_EXISTS" },
  );

  assert.equal(fake.spawnEvents.some(({ args }) => args.includes("run")), false);
  assert.equal(fake.spawnEvents.some(({ args }) => args.includes("stop")), false);
});

test("refuses occupied API or Web ports before spawning commands", async () => {
  for (const occupiedPort of [3100, 3000]) {
    const fake = createFakeDependencies({ occupiedPorts: [occupiedPort] });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
      }),
      { message: `PLATFORM_E2E_PORT_IN_USE:${occupiedPort}` },
    );

    assert.deepEqual(fake.spawnEvents, []);
  }
});

test("retries a valid 503 not-ready response and starts Web only after exact readiness", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [
      healthNotReadyResponse(),
      healthReadyResponse(),
      webReadyResponse(),
    ],
  });

  await runPlatformE2E({
    dependencies: fake.dependencies,
    environment: { DATABASE_URL: SAFE_DATABASE_URL },
    readinessAttempts: 2,
  });

  const fetchUrls = fake.events
    .filter(({ kind }) => kind === "fetch")
    .map(({ url }) => url);
  const finalHealthFetchIndex = fake.events.findLastIndex(
    ({ kind, url }) => kind === "fetch" && url.endsWith("/health/ready"),
  );
  const webSpawnIndex = fake.events.findIndex(
    ({ kind, options }) => kind === "spawn" && options.label === "web",
  );
  assert.deepEqual(fetchUrls, [
    "http://127.0.0.1:3100/health/ready",
    "http://127.0.0.1:3100/health/ready",
    "http://127.0.0.1:3000/en",
  ]);
  assert.equal(webSpawnIndex > finalHealthFetchIndex, true);
  assert.deepEqual(fake.startedServerLabels, ["api", "web"]);
});

test("does not start Web when readiness remains 503 through the final attempt", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [healthNotReadyResponse(), healthNotReadyResponse()],
  });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: { DATABASE_URL: SAFE_DATABASE_URL },
      readinessAttempts: 2,
    }),
    { message: "PLATFORM_E2E_API_READINESS_TIMEOUT" },
  );

  const fetchUrls = fake.events
    .filter(({ kind }) => kind === "fetch")
    .map(({ url }) => url);
  assert.deepEqual(fetchUrls, [
    "http://127.0.0.1:3100/health/ready",
    "http://127.0.0.1:3100/health/ready",
  ]);
  assert.equal(fake.startedServerLabels.includes("web"), false);
  assert.deepEqual(fake.killedProcessLabels, ["api"]);
});

test("rejects readiness responses unless status, content type, and body shape are exact", async () => {
  const badResponses = [
    new Response(JSON.stringify({ status: "ready" }), {
      headers: { "content-type": "application/json" },
      status: 201,
    }),
    new Response(JSON.stringify({ status: "ready" }), {
      headers: { "content-type": "text/plain" },
      status: 200,
    }),
    new Response("not-json", {
      headers: { "content-type": "application/json" },
      status: 200,
    }),
    jsonResponse(null),
    jsonResponse([]),
    jsonResponse({ status: "ok" }),
    jsonResponse({ extra: true, status: "ready" }),
  ];

  for (const response of badResponses) {
    const fake = createFakeDependencies({ fetchResponses: [response] });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
      }),
      { message: "PLATFORM_E2E_API_READINESS_INVALID" },
    );

    const fetchUrls = fake.events
      .filter(({ kind }) => kind === "fetch")
      .map(({ url }) => url);
    assert.deepEqual(fetchUrls, ["http://127.0.0.1:3100/health/ready"]);
    assert.equal(fake.startedServerLabels.includes("web"), false);
    assert.deepEqual(fake.killedProcessLabels, ["api"]);
  }
});

test("rejects readiness bodies paired with the wrong status or extra fields", async () => {
  const invalidPairings = [
    ["503 ready", jsonResponse({ status: "ready" }, 503)],
    [
      "503 not-ready with an extra field",
      jsonResponse({ extra: true, status: "not_ready" }, 503),
    ],
    ["200 not-ready", jsonResponse({ status: "not_ready" })],
  ];

  for (const [label, response] of invalidPairings) {
    const fake = createFakeDependencies({ fetchResponses: [response] });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
      }),
      { message: "PLATFORM_E2E_API_READINESS_INVALID" },
      label,
    );

    assert.equal(fake.startedServerLabels.includes("web"), false, label);
    assert.deepEqual(fake.killedProcessLabels, ["api"], label);
  }
});

test("bounds a pending API readiness fetch, retries, and cleans the owned API", async () => {
  const fake = createFakeDependencies({ pendingFetch: "api" });

  await assert.rejects(
    withTestDeadline(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 2,
        readinessRequestTimeoutMs: 10,
      }),
      500,
    ),
    { message: "PLATFORM_E2E_API_READINESS_TIMEOUT" },
  );

  const fetchUrls = fake.events
    .filter(({ kind }) => kind === "fetch")
    .map(({ url }) => url);
  assert.deepEqual(fetchUrls, [
    "http://127.0.0.1:3100/health/ready",
    "http://127.0.0.1:3100/health/ready",
  ]);
  assert.equal(fake.startedServerLabels.includes("web"), false);
  assert.deepEqual(fake.killedProcessLabels, ["api"]);
  assert.equal(fake.fetchSignals.length, 2);
  assert.equal(fake.fetchSignals.every((signal) => signal?.aborted === true), true);
});

test("bounds a pending Web readiness fetch and cleans both owned servers", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse()],
    pendingFetch: "web",
  });

  await assert.rejects(
    withTestDeadline(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
        readinessRequestTimeoutMs: 10,
      }),
      500,
    ),
    { message: "PLATFORM_E2E_WEB_READINESS_TIMEOUT" },
  );

  assert.deepEqual(fake.killedProcessLabels, ["web", "api"]);
  assert.equal(fake.fetchSignals.at(-1)?.aborted, true);
});

test("fails when either managed server exits before readiness", async () => {
  for (const label of ["api", "web"]) {
    const fake = createFakeDependencies({
      earlyExitServer: label,
      fetchResponses: label === "web" ? [healthReadyResponse()] : [],
    });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
      }),
      { message: `PLATFORM_E2E_CHILD_EXITED:${label}` },
    );

    if (label === "api") {
      assert.equal(fake.startedServerLabels.includes("web"), false);
    }
  }
});

test("kills Playwright when a managed server exits during its run", async () => {
  for (const label of ["api", "web"]) {
    const fake = createFakeDependencies({
      fetchResponses: [healthReadyResponse(), webReadyResponse()],
      serverExitDuringPlaywright: label,
    });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
      }),
      { message: `PLATFORM_E2E_CHILD_EXITED:${label}` },
    );

    assert.deepEqual(fake.killedProcessLabels, ["playwright", "web", "api"]);
  }
});

test("cleans up only owned process groups and the exact created container id", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse(), webReadyResponse()],
  });

  await runPlatformE2E({
    dependencies: fake.dependencies,
    environment: {},
    readinessAttempts: 1,
  });

  assert.deepEqual(fake.startedServerLabels, ["api", "web"]);
  assert.deepEqual(fake.killedProcessLabels, ["playwright", "web", "api"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(
    fake.spawnEvents.some(({ args }) =>
      args[0] === "stop" && args.includes("navigator-platform-e2e-postgres")
    ),
    false,
  );
});

test("entrypoint interruption waits for one ordered cleanup and restores signal handlers", async () => {
  const runEntrypoint = orchestrator.runPlatformE2EEntrypoint;
  assert.equal(typeof runEntrypoint, "function");
  if (typeof runEntrypoint !== "function") return;

  const controller = new EventEmitter();
  const stderr = [];
  const existingSigintListener = () => undefined;
  controller.on("SIGINT", existingSigintListener);
  controller.stderr = { write: (value) => stderr.push(String(value)) };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse(), webReadyResponse()],
    onSpawn: ({ options }) => {
      if (options.label !== "playwright") return;
      queueMicrotask(() => {
        controller.emit("SIGTERM");
        controller.emit("SIGINT");
        controller.emit("SIGTERM");
      });
    },
    pendingPlaywright: true,
  });

  await withTestDeadline(
    runEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    500,
  );

  assert.equal(controller.exitCode, 143);
  assert.deepEqual(stderr, ["PLATFORM_E2E_INTERRUPTED:SIGTERM\n"]);
  assert.deepEqual(fake.killedProcessLabels, ["playwright", "web", "api"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.deepEqual(controller.listeners("SIGINT"), [existingSigintListener]);
  assert.equal(controller.listenerCount("SIGTERM"), 0);
});

test("entrypoint interruption terminates an active owned command before container cleanup", async () => {
  const runEntrypoint = orchestrator.runPlatformE2EEntrypoint;
  assert.equal(typeof runEntrypoint, "function");
  if (typeof runEntrypoint !== "function") return;

  const controller = new EventEmitter();
  controller.stderr = { write: () => undefined };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    onSpawn: ({ options }) => {
      if (options.label === "api-build") {
        queueMicrotask(() => controller.emit("SIGINT"));
      }
    },
    pendingCommand: "api-build",
  });

  await withTestDeadline(
    runEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    500,
  );

  assert.equal(controller.exitCode, 130);
  assert.deepEqual(fake.killedProcessLabels, ["api-build"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(fake.startedServerLabels.length, 0);
});

test("sweeps each detached command group after its leader completes", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse(), webReadyResponse()],
  });

  await runPlatformE2E({
    dependencies: fake.dependencies,
    environment: { DATABASE_URL: SAFE_DATABASE_URL },
    readinessAttempts: 1,
  });

  const commandLabels = fake.spawnEvents
    .filter(({ options }) => options.kind === "command")
    .map(({ options }) => options.label);
  assert.deepEqual(commandLabels, [
    "prisma-generate",
    "prisma-migrate-deploy",
    "approved-basic-import",
    "api-build",
    "web-build",
  ]);
  assert.deepEqual(
    fake.cleanedProcessLabels.filter((label) => commandLabels.includes(label)),
    commandLabels,
  );
});

test("eliminates a detached command descendant after its leader completes", {
  skip: process.platform === "win32",
}, async () => {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "navigator-command-pgid-"));
  const pidMarkerPath = join(fixtureDirectory, "descendant-pid");
  const termMarkerPath = join(fixtureDirectory, "term-observed");
  const descendantScript = [
    "const { writeFileSync } = require('node:fs');",
    `process.on('SIGTERM', () => writeFileSync(${JSON.stringify(termMarkerPath)}, 'observed'));`,
    "process.stdout.write('ready\\n');",
    "setInterval(() => {}, 1000);",
  ].join("");
  const leaderScript = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
    "child.stdout.once('data', () => {",
    `  writeFileSync(${JSON.stringify(pidMarkerPath)}, String(child.pid));`,
    "  child.stdout.destroy();",
    "  child.unref();",
    "});",
  ].join("\n");
  const fake = createFakeDependencies({
    fetchResponses: [healthReadyResponse(), webReadyResponse()],
  });
  const fakeSpawn = fake.dependencies.spawn;
  let commandGroupId;
  const dependencies = {
    ...fake.dependencies,
    spawn: (command, args, options) => {
      if (options.label !== "api-build") return fakeSpawn(command, args, options);
      const spawned = orchestrator.spawnProcess(
        process.execPath,
        ["-e", leaderScript],
        {
          ...options,
          groupPollIntervalMs: 5,
          killGraceMs: 1_000,
          terminateGraceMs: 30,
        },
      );
      commandGroupId = spawned.pid;
      return spawned;
    },
  };
  let descendantPid;

  try {
    await runPlatformE2E({
      dependencies,
      environment: { DATABASE_URL: SAFE_DATABASE_URL },
      readinessAttempts: 1,
    });
    descendantPid = Number(await readFile(pidMarkerPath, "utf8"));
    assert.equal(await readFile(termMarkerPath, "utf8"), "observed");
    assert.equal(processExists(descendantPid), false);
    assert.equal(processGroupExists(commandGroupId), false);
  } finally {
    await terminateTestProcessGroup(commandGroupId);
    if (processExists(descendantPid)) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test("reports the first active-command cleanup failure before later container cleanup failures", async () => {
  const controller = new EventEmitter();
  const stderr = [];
  controller.stderr = { write: (value) => stderr.push(String(value)) };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    commandExitCodes: { "container-stop": 1 },
    failedCleanupLabels: ["api-build"],
    onSpawn: ({ options }) => {
      if (options.label === "api-build") {
        queueMicrotask(() => controller.emit("SIGINT"));
      }
    },
    pendingCommand: "api-build",
  });

  await withTestDeadline(
    orchestrator.runPlatformE2EEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    500,
  );

  assert.equal(controller.exitCode, 130);
  assert.deepEqual(stderr, ["PLATFORM_E2E_CLEANUP_FAILED:api-build\n"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
});

test("entrypoint preserves the first signal during API or Web readiness", async () => {
  for (const target of ["api", "web"]) {
    const controller = new EventEmitter();
    const stderr = [];
    controller.stderr = { write: (value) => stderr.push(String(value)) };
    controller.exitCode = undefined;
    const fake = createFakeDependencies({
      fetchResponses: target === "web" ? [healthReadyResponse()] : [],
      onFetch: (url) => {
        if (url.includes(`:${target === "api" ? 3100 : 3000}/`)) {
          queueMicrotask(() => controller.emit("SIGINT"));
        }
      },
      pendingFetch: target,
    });

    await withTestDeadline(
      orchestrator.runPlatformE2EEntrypoint({
        controller,
        runOptions: {
          dependencies: fake.dependencies,
          environment: { DATABASE_URL: SAFE_DATABASE_URL },
          readinessAttempts: 1,
          readinessRequestTimeoutMs: 100,
        },
      }),
      500,
    );

    assert.equal(controller.exitCode, 130);
    assert.deepEqual(stderr, ["PLATFORM_E2E_INTERRUPTED:SIGINT\n"]);
    assert.deepEqual(
      fake.killedProcessLabels,
      target === "api" ? ["api"] : ["web", "api"],
    );
  }
});

test("signal during Docker creation waits to record and stop only the returned container id", async () => {
  const controller = new EventEmitter();
  controller.stderr = { write: () => undefined };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    onSpawn: ({ options }) => {
      if (options.label === "container-create") {
        queueMicrotask(() => controller.emit("SIGTERM"));
      }
    },
  });

  await withTestDeadline(
    orchestrator.runPlatformE2EEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    500,
  );

  assert.equal(controller.exitCode, 143);
  assert.deepEqual(fake.killedProcessLabels, []);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
});

test("interrupts a pending Docker creation and stops only its task-owned receipt id", async () => {
  const controller = new EventEmitter();
  const stderr = [];
  const existingSigtermListener = () => undefined;
  controller.on("SIGTERM", existingSigtermListener);
  controller.stderr = { write: (value) => stderr.push(String(value)) };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    completionRemainsPendingAfterKill: ["container-create"],
    onSpawn: ({ options }) => {
      if (options.label !== "container-create") return;
      queueMicrotask(() => {
        controller.emit("SIGINT");
        controller.emit("SIGTERM");
        controller.emit("SIGINT");
      });
    },
    pendingCommand: "container-create",
  });

  await withTestDeadline(
    orchestrator.runPlatformE2EEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    200,
  );

  assert.equal(controller.exitCode, 130);
  assert.deepEqual(stderr, ["PLATFORM_E2E_INTERRUPTED:SIGINT\n"]);
  assert.equal(
    fake.cleanedProcessLabels.filter((label) => label === "container-create").length,
    1,
  );
  assert.deepEqual(fake.killedProcessLabels, ["container-create"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(stops.some(({ args }) => args.includes("navigator-platform-e2e-postgres")), false);
  assert.equal(fake.containerReceiptPaths.length, 1);
  assert.equal(existsSync(fake.containerReceiptPaths[0]), false);
  assert.deepEqual(controller.listeners("SIGTERM"), [existingSigtermListener]);
  assert.equal(controller.listenerCount("SIGINT"), 0);
});

test("records and stops the returned container before reporting create-group cleanup failure", async () => {
  const fake = createFakeDependencies({
    failedCleanupLabels: ["container-create"],
  });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {},
      readinessAttempts: 1,
    }),
    { message: "PLATFORM_E2E_CLEANUP_FAILED:container-create" },
  );

  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
});

test("fails closed when Docker stdout disagrees with its task-owned receipt", async () => {
  const fake = createFakeDependencies({
    containerReceiptId: "receipt-container-id",
    containerStdoutId: "different-container-id",
  });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {},
      readinessAttempts: 1,
    }),
    { message: "PLATFORM_E2E_CONTAINER_ID_MISMATCH" },
  );

  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "receipt-container-id"]]);
  assert.equal(stops.some(({ args }) => args.includes("navigator-platform-e2e-postgres")), false);
  assert.equal(fake.containerReceiptPaths.length, 1);
  assert.equal(existsSync(fake.containerReceiptPaths[0]), false);
});

test("fails closed on missing or malformed task-owned container receipts", async () => {
  for (const receiptOptions of [
    { containerReceiptId: null },
    { containerReceiptId: " owned-container-id" },
    { containerReceiptId: "owned-container-id\nother-container-id" },
    { containerReceiptContents: "owned-container-id\n\n" },
    { containerReceiptContents: "owned-container-id\r\n\r\n" },
  ]) {
    const fake = createFakeDependencies(receiptOptions);

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      }),
      { message: "PLATFORM_E2E_CONTAINER_ID_INVALID" },
    );

    const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
    assert.deepEqual(stops, []);
    assert.equal(fake.containerReceiptPaths.length, 1);
    assert.equal(existsSync(fake.containerReceiptPaths[0]), false);
  }
});

test("bounds a pending Docker creation without an external signal", async () => {
  const fake = createFakeDependencies({ pendingCommand: "container-create" });

  await assert.rejects(
    withTestDeadline(
      runPlatformE2E({
        containerCreateTimeoutMs: 20,
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      }),
      200,
    ),
    { message: "PLATFORM_E2E_COMMAND_FAILED:container-create" },
  );

  assert.equal(
    fake.cleanedProcessLabels.filter((label) => label === "container-create").length,
    1,
  );
  assert.deepEqual(fake.killedProcessLabels, ["container-create"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(fake.containerReceiptPaths.length, 1);
  assert.equal(existsSync(fake.containerReceiptPaths[0]), false);
});

test("maps receipt-directory removal failures and still stops the exact owned id", async () => {
  const fake = createFakeDependencies({
    commandExitCodes: { "container-stop": 1 },
    failedReceiptCleanup: true,
  });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {},
      readinessAttempts: 1,
    }),
    { message: "PLATFORM_E2E_CLEANUP_FAILED:container-receipt" },
  );

  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(fake.containerReceiptPaths.length, 1);
  assert.equal(existsSync(fake.containerReceiptPaths[0]), false);
});

test("preserves earlier create cleanup failure over receipt and stop failures", async () => {
  const fake = createFakeDependencies({
    commandExitCodes: { "container-stop": 1 },
    failedCleanupLabels: ["container-create"],
    failedReceiptCleanup: true,
  });

  await assert.rejects(
    runPlatformE2E({
      dependencies: fake.dependencies,
      environment: {},
      readinessAttempts: 1,
    }),
    { message: "PLATFORM_E2E_CLEANUP_FAILED:container-create" },
  );

  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
});

test("bounds a pending Docker stop with an independent cleanup watchdog", async () => {
  for (const [firstSignal, repeatedSignal, expectedExitCode] of [
    ["SIGINT", "SIGTERM", 130],
    ["SIGTERM", "SIGINT", 143],
  ]) {
    const controller = new EventEmitter();
    const stderr = [];
    const existingListener = () => undefined;
    controller.on(firstSignal, existingListener);
    controller.stderr = { write: (value) => stderr.push(String(value)) };
    controller.exitCode = undefined;
    const fake = createFakeDependencies({
      completionRemainsPendingAfterKill: ["container-stop"],
      fetchResponses: [healthReadyResponse(), webReadyResponse()],
      onSpawn: ({ options }) => {
        if (options.label !== "playwright") return;
        queueMicrotask(() => {
          controller.emit(firstSignal);
          controller.emit(repeatedSignal);
          controller.emit(firstSignal);
        });
      },
      pendingCommand: "container-stop",
      pendingPlaywright: true,
    });

    await withTestDeadline(
      orchestrator.runPlatformE2EEntrypoint({
        controller,
        runOptions: {
          containerStopTimeoutMs: 20,
          dependencies: fake.dependencies,
          environment: {},
          readinessAttempts: 1,
        },
      }),
      300,
    );

    assert.equal(controller.exitCode, expectedExitCode);
    assert.deepEqual(stderr, ["PLATFORM_E2E_CLEANUP_FAILED:container\n"]);
    assert.equal(
      fake.cleanedProcessLabels.filter((label) => label === "container-stop").length,
      1,
    );
    assert.equal(
      fake.killedProcessLabels.filter((label) => label === "container-stop").length,
      1,
    );
    const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
    assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
    assert.equal(fake.activeWatchdogTimers.size, 0);
    assert.deepEqual(controller.listeners(firstSignal), [existingListener]);
    assert.equal(controller.listenerCount(repeatedSignal), 0);
  }
});

test("rejects invalid container watchdog timeouts before side effects", async () => {
  for (const [optionName, expectedMessage] of [
    ["containerCreateTimeoutMs", "PLATFORM_E2E_CONTAINER_CREATE_TIMEOUT_INVALID"],
    ["containerStopTimeoutMs", "PLATFORM_E2E_CONTAINER_STOP_TIMEOUT_INVALID"],
  ]) {
    for (const invalidValue of [
      0,
      -1,
      1.5,
      "20",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      2_147_483_648,
      Number.MAX_SAFE_INTEGER,
    ]) {
      const fake = createFakeDependencies();

      await assert.rejects(
        runPlatformE2E({
          dependencies: fake.dependencies,
          environment: { DATABASE_URL: SAFE_DATABASE_URL },
          [optionName]: invalidValue,
        }),
        { message: expectedMessage },
      );

      assert.deepEqual(fake.events, []);
    }
  }
});

test("entrypoint interruption cancels the pre-acquisition Docker port probe", async () => {
  const controller = new EventEmitter();
  controller.stderr = { write: () => undefined };
  controller.exitCode = undefined;
  const fake = createFakeDependencies({
    onProbe: (port) => {
      if (port === 55433) queueMicrotask(() => controller.emit("SIGINT"));
    },
    pendingProbePort: 55433,
  });

  await withTestDeadline(
    orchestrator.runPlatformE2EEntrypoint({
      controller,
      runOptions: {
        dependencies: fake.dependencies,
        environment: {},
        readinessAttempts: 1,
      },
    }),
    100,
  );

  assert.equal(controller.exitCode, 130);
  assert.equal(
    fake.spawnEvents.some(({ options }) => options.label === "container-create"),
    false,
  );
});

test("real child entrypoint handles SIGTERM without retaining its handlers", {
  skip: process.platform === "win32",
}, async () => {
  const runEntrypoint = orchestrator.runPlatformE2EEntrypoint;
  assert.equal(typeof runEntrypoint, "function");
  if (typeof runEntrypoint !== "function") return;

  const moduleUrl = new URL("./run-platform-e2e.mjs", import.meta.url).href;
  const harnessScript = [
    `import { runPlatformE2EEntrypoint } from ${JSON.stringify(moduleUrl)};`,
    "const before = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, process.listenerCount(signal)]));",
    "await runPlatformE2EEntrypoint({",
    "  controller: process,",
    "  run: ({ interruptSignal }) => new Promise((resolve, reject) => {",
    "    let interrupted = false;",
    "    const keepAlive = setInterval(() => undefined, 1_000);",
    "    const onAbort = () => {",
    "      if (interrupted) return;",
    "      interrupted = true;",
    "      clearInterval(keepAlive);",
    "      process.stdout.write('interrupted\\n');",
    "      queueMicrotask(() => reject(interruptSignal.reason));",
    "    };",
    "    interruptSignal.addEventListener('abort', onAbort, { once: true });",
    "    process.stdout.write('ready\\n');",
    "    if (interruptSignal.aborted) onAbort();",
    "  }),",
    "});",
    "for (const [signal, count] of before) {",
    "  if (process.listenerCount(signal) !== count) throw new Error(`HANDLER_LEAK:${signal}`);",
    "}",
    "process.stdout.write('cleaned\\n');",
  ].join("\n");
  const harness = spawnChildProcess(
    process.execPath,
    ["--input-type=module", "--eval", harnessScript],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  try {
    await waitForChildOutput(harness, "ready\n", 1_000);
    const resultPromise = collectChildResult(harness, 1_000);
    assert.equal(harness.kill("SIGTERM"), true);
    const result = await resultPromise;
    assert.equal(result.code, 143, result.stderr);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "PLATFORM_E2E_INTERRUPTED:SIGTERM\n");
    assert.match(result.stdout, /interrupted\ncleaned\n/u);
  } finally {
    await terminateTestProcessGroup(harness.pid);
  }
});

test("eliminates a saved process group when its leader exits before a SIGTERM-ignoring descendant", {
  skip: process.platform === "win32",
}, async () => {
  const spawnProcess = orchestrator.spawnProcess;
  assert.equal(typeof spawnProcess, "function");
  if (typeof spawnProcess !== "function") return;

  const fixtureDirectory = await mkdtemp(join(tmpdir(), "navigator-pgid-"));
  const pidMarkerPath = join(fixtureDirectory, "descendant-pid");
  const termMarkerPath = join(fixtureDirectory, "term-observed");
  const descendantScript = [
    "const { writeFileSync } = require('node:fs');",
    `process.on('SIGTERM', () => writeFileSync(${JSON.stringify(termMarkerPath)}, 'observed'));`,
    "process.stdout.write('ready\\n');",
    "setInterval(() => {}, 1000);",
  ].join("");
  const leaderScript = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: ['ignore', 'pipe', 'ignore'] });`,
    "child.stdout.once('data', () => {",
    `  writeFileSync(${JSON.stringify(pidMarkerPath)}, String(child.pid));`,
    "  child.stdout.destroy();",
    "  child.unref();",
    "  process.exit(0);",
    "});",
  ].join("\n");
  const spawned = spawnProcess(process.execPath, ["-e", leaderScript], {
    environment: process.env,
    groupPollIntervalMs: 5,
    killGraceMs: 1_000,
    kind: "server",
    label: "leader-first-fixture",
    terminateGraceMs: 30,
  });
  const groupId = spawned.pid;
  let descendantPid;

  try {
    assert.equal(typeof groupId, "number");
    await withTestDeadline(spawned.completion, 1_000);
    descendantPid = Number(await readFile(pidMarkerPath, "utf8"));
    assert.equal(Number.isInteger(descendantPid), true);
    assert.equal(processExists(descendantPid), true);
    assert.equal(processGroupExists(groupId), true);

    await withTestDeadline(spawned.killGroup(), 2_000);
    assert.equal(await readFile(termMarkerPath, "utf8"), "observed");
    await waitUntil(
      () => !processGroupExists(groupId) && !processExists(descendantPid),
      1_000,
    );
  } finally {
    if (processGroupExists(groupId)) {
      forceSignalGroup(groupId, "SIGKILL");
      await waitUntil(() => !processGroupExists(groupId), 1_000);
    }
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

test("does not retain a completed process-group cleanup watchdog timer", {
  skip: process.platform === "win32",
}, async () => {
  const moduleUrl = new URL("./run-platform-e2e.mjs", import.meta.url).href;
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "navigator-watchdog-"));
  const innerGroupMarkerPath = join(fixtureDirectory, "inner-group-id");
  const harnessScript = [
    "import { writeFileSync } from 'node:fs';",
    `import { spawnProcess } from ${JSON.stringify(moduleUrl)};`,
    "const child = spawnProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {",
    "  environment: process.env,",
    "  kind: 'server',",
    "  label: 'timer-fixture',",
    "  terminateGraceMs: 200,",
    "  killGraceMs: 200,",
    "  groupPollIntervalMs: 5,",
    "});",
    `writeFileSync(${JSON.stringify(innerGroupMarkerPath)}, String(child.pid));`,
    "await new Promise((resolve) => setTimeout(resolve, 100));",
    "await child.killGroup();",
    "await child.completion;",
  ].join("\n");
  const harness = spawnChildProcess(
    process.execPath,
    ["--input-type=module", "--eval", harnessScript],
    { detached: true, stdio: ["ignore", "pipe", "pipe"] },
  );

  let innerGroupId;
  try {
    const result = await collectChildResult(harness, 1_000);
    assert.equal(result.code, 0, result.stderr);
  } finally {
    try {
      innerGroupId = Number(await readFile(innerGroupMarkerPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await terminateTestProcessGroup(innerGroupId);
    await terminateTestProcessGroup(harness.pid);
    await rm(fixtureDirectory, { force: true, recursive: true });
  }
});

function createFakeDependencies(options = {}) {
  const events = [];
  const spawnEvents = [];
  const startedServerLabels = [];
  const killedProcessLabels = [];
  const cleanedProcessLabels = [];
  const containerReceiptPaths = [];
  const activeWatchdogTimers = new Set();
  const fetchSignals = [];
  const fetchResponses = [...(options.fetchResponses ?? [])];
  const serverResolvers = new Map();
  let nextPid = 1000;

  const dependencies = {
    clearTimeout: (timer) => {
      clearTimeout(timer);
      activeWatchdogTimers.delete(timer);
    },
    delay: async () => undefined,
    fetch: async (url, init) => {
      const urlString = String(url);
      events.push({ kind: "fetch", url: urlString });
      fetchSignals.push(init?.signal);
      options.onFetch?.(urlString, init);
      if (
        (options.pendingFetch === "api" && urlString.includes(":3100/")) ||
        (options.pendingFetch === "web" && urlString.includes(":3000/"))
      ) {
        return new Promise(() => undefined);
      }
      const response = fetchResponses.shift();
      if (response === undefined) {
        throw new Error("FAKE_FETCH_RESPONSE_MISSING");
      }
      return response;
    },
    probePort: async (_host, port) => {
      events.push({ kind: "probePort", port });
      options.onProbe?.(port);
      if (options.pendingProbePort === port) {
        return new Promise(() => undefined);
      }
      return !(options.occupiedPorts ?? []).includes(port);
    },
    removeDirectory: async (path, removeOptions) => {
      await rm(path, removeOptions);
      if (options.failedReceiptCleanup) {
        throw new Error(`FAKE_RECEIPT_CLEANUP_FAILED:${path}`);
      }
    },
    setTimeout: (callback, milliseconds) => {
      let timer;
      timer = setTimeout(callback, milliseconds);
      activeWatchdogTimers.add(timer);
      return timer;
    },
    spawn: (command, args, spawnOptions) => {
      const event = { args: [...args], command, options: spawnOptions };
      events.push({ kind: "spawn", ...event });
      spawnEvents.push(event);
      const label = spawnOptions.label;
      const pid = nextPid++;
      let resolveCompletion;
      const pendingCompletion = new Promise((resolve) => {
        resolveCompletion = resolve;
      });
      let completion;
      let stdout = "";

      if (command === "docker" && args[0] === "ps") {
        stdout = options.existingContainerId ?? "";
      } else if (command === "docker" && args[0] === "run") {
        const cidfileIndex = args.indexOf("--cidfile");
        if (cidfileIndex !== -1) {
          const receiptPath = args[cidfileIndex + 1];
          containerReceiptPaths.push(receiptPath);
          if (options.containerReceiptId !== null) {
            writeFileSync(
              receiptPath,
              options.containerReceiptContents ??
                `${options.containerReceiptId ?? "owned-container-id"}\n`,
            );
          }
        }
        stdout = `${options.containerStdoutId ?? "owned-container-id"}\n`;
      } else if (
        command === "pnpm" &&
        args.includes("import:approved-basic-publications")
      ) {
        stdout = [
          "> @navigator/db import:approved-basic-publications",
          JSON.stringify({ countryCount: 6, operationCount: 72, status: "ok" }),
          "",
        ].join("\n");
      }

      if (spawnOptions.kind === "server") {
        startedServerLabels.push(label);
        serverResolvers.set(label, resolveCompletion);
        if (options.earlyExitServer === label) {
          completion = Promise.resolve({ code: 1, signal: null, stdout: "" });
        } else {
          completion = pendingCompletion;
        }
      } else if (label === "playwright" && options.serverExitDuringPlaywright) {
        completion = pendingCompletion;
        queueMicrotask(() => {
          serverResolvers.get(options.serverExitDuringPlaywright)?.({
            code: 1,
            signal: null,
            stdout: "",
          });
        });
      } else if (label === "playwright" && options.pendingPlaywright) {
        completion = pendingCompletion;
      } else if (
        spawnOptions.kind === "command" &&
        options.pendingCommand === label
      ) {
        completion = pendingCompletion;
      } else if (options.commandExitCodes?.[label] !== undefined) {
        completion = Promise.resolve({
          code: options.commandExitCodes[label],
          signal: null,
          stdout,
        });
      } else {
        completion = Promise.resolve({ code: 0, signal: null, stdout });
      }

      let completed = false;
      const trackedCompletion = completion.then((result) => {
        completed = true;
        return result;
      });
      options.onSpawn?.(event);

      return {
        completion: trackedCompletion,
        killGroup: async () => {
          cleanedProcessLabels.push(label);
          if (spawnOptions.kind !== "command" || !completed) {
            killedProcessLabels.push(label);
          }
          if (options.failedCleanupLabels?.includes(label)) {
            throw new Error(`FAKE_CLEANUP_FAILED:${label}`);
          }
          if (!options.completionRemainsPendingAfterKill?.includes(label)) {
            resolveCompletion({ code: null, signal: "SIGTERM", stdout: "" });
          }
        },
        pid,
      };
    },
  };

  return {
    activeWatchdogTimers,
    cleanedProcessLabels,
    containerReceiptPaths,
    dependencies,
    events,
    fetchSignals,
    killedProcessLabels,
    spawnEvents,
    startedServerLabels,
  };
}

function healthReadyResponse() {
  return jsonResponse({ status: "ready" });
}

function healthNotReadyResponse() {
  return jsonResponse({ status: "not_ready" }, 503);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8" },
    status,
  });
}

function webReadyResponse() {
  return new Response("ok", { status: 200 });
}

async function withTestDeadline(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("TEST_DEADLINE_EXCEEDED")),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function processGroupExists(groupId) {
  if (!Number.isInteger(groupId)) return false;
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("TEST_CONDITION_TIMEOUT");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function forceSignalGroup(groupId, signal) {
  if (!Number.isInteger(groupId)) return;
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function collectChildResult(child, timeoutMs) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      forceSignalGroup(child.pid, "SIGKILL");
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error("TEST_CHILD_EXIT_TIMEOUT"));
      else resolve({ code, signal, stderr, stdout });
    });
  });
}

function waitForChildOutput(child, expected, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("TEST_CHILD_OUTPUT_TIMEOUT"));
    }, timeoutMs);
    const onData = (chunk) => {
      stdout += String(chunk);
      if (stdout.includes(expected)) {
        cleanup();
        resolve();
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error("TEST_CHILD_CLOSED_BEFORE_OUTPUT"));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      child.stdout.removeListener("data", onData);
      child.removeListener("close", onClose);
    };
    child.stdout.on("data", onData);
    child.once("close", onClose);
  });
}

async function terminateTestProcessGroup(groupId) {
  if (!Number.isInteger(groupId) || !processGroupExists(groupId)) return;
  forceSignalGroup(groupId, "SIGTERM");
  if (await waitForTestProcessGroupExit(groupId, 100)) return;
  forceSignalGroup(groupId, "SIGKILL");
  if (!(await waitForTestProcessGroupExit(groupId, 1_000))) {
    throw new Error("TEST_PROCESS_GROUP_CLEANUP_TIMEOUT");
  }
}

async function waitForTestProcessGroupExit(groupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(groupId)) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}
