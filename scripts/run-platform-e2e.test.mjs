import assert from "node:assert/strict";
import test from "node:test";

import { runPlatformE2E } from "./run-platform-e2e.mjs";

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

test("does not start Web when the countries probe is non-200 or non-JSON", async () => {
  const badResponses = [
    new Response(JSON.stringify({ data: [], success: true }), {
      headers: { "content-type": "application/json" },
      status: 503,
    }),
    new Response("not-json", {
      headers: { "content-type": "text/plain" },
      status: 200,
    }),
  ];

  for (const response of badResponses) {
    const fake = createFakeDependencies({ fetchResponses: [response] });

    await assert.rejects(
      runPlatformE2E({
        dependencies: fake.dependencies,
        environment: { DATABASE_URL: SAFE_DATABASE_URL },
        readinessAttempts: 1,
      }),
      { message: "PLATFORM_E2E_COUNTRIES_READINESS_INVALID" },
    );

    assert.equal(fake.startedServerLabels.includes("web"), false);
    assert.deepEqual(fake.killedServerLabels, ["api"]);
  }
});

test("fails when either managed server exits before readiness", async () => {
  for (const label of ["api", "web"]) {
    const fake = createFakeDependencies({
      earlyExitServer: label,
      fetchResponses: label === "web" ? [countriesReadyResponse()] : [],
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

test("cleans up only owned process groups and the exact created container id", async () => {
  const fake = createFakeDependencies({
    fetchResponses: [countriesReadyResponse(), webReadyResponse()],
  });

  await runPlatformE2E({
    dependencies: fake.dependencies,
    environment: {},
    readinessAttempts: 1,
  });

  assert.deepEqual(fake.startedServerLabels, ["api", "web"]);
  assert.deepEqual(fake.killedServerLabels, ["web", "api"]);
  const stops = fake.spawnEvents.filter(({ args }) => args[0] === "stop");
  assert.deepEqual(stops.map(({ args }) => args), [["stop", "owned-container-id"]]);
  assert.equal(
    fake.spawnEvents.some(({ args }) =>
      args[0] === "stop" && args.includes("navigator-platform-e2e-postgres")
    ),
    false,
  );
});

function createFakeDependencies(options = {}) {
  const events = [];
  const spawnEvents = [];
  const startedServerLabels = [];
  const killedServerLabels = [];
  const fetchResponses = [...(options.fetchResponses ?? [])];
  let nextPid = 1000;

  const dependencies = {
    delay: async () => undefined,
    fetch: async (url) => {
      events.push({ kind: "fetch", url: String(url) });
      const response = fetchResponses.shift();
      if (response === undefined) {
        throw new Error("FAKE_FETCH_RESPONSE_MISSING");
      }
      return response;
    },
    probePort: async (_host, port) => {
      events.push({ kind: "probePort", port });
      return !(options.occupiedPorts ?? []).includes(port);
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
      let exitCode = 0;

      if (command === "docker" && args[0] === "ps") {
        stdout = options.existingContainerId ?? "";
      } else if (command === "docker" && args[0] === "run") {
        stdout = "owned-container-id\n";
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
        if (options.earlyExitServer === label) {
          completion = Promise.resolve({ code: 1, signal: null, stdout: "" });
        } else {
          completion = pendingCompletion;
        }
      } else {
        completion = Promise.resolve({ code: exitCode, signal: null, stdout });
      }

      return {
        completion,
        killGroup: async () => {
          killedServerLabels.push(label);
          resolveCompletion({ code: null, signal: "SIGTERM", stdout: "" });
        },
        pid,
      };
    },
  };

  return {
    dependencies,
    events,
    killedServerLabels,
    spawnEvents,
    startedServerLabels,
  };
}

function countriesReadyResponse() {
  return new Response(JSON.stringify({
    data: Array.from({ length: 6 }, (_, index) => ({ code: `Z${index}` })),
    meta: { locale: "en", page: 1, pageSize: 20, textMode: "localized", total: 6 },
    success: true,
  }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function webReadyResponse() {
  return new Response("ok", { status: 200 });
}
