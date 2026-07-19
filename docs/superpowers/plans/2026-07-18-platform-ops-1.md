# PLATFORM-OPS-1 并发与运行治理基线实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task after PLATFORM-API-1 is merged. Use `superpowers:test-driven-development` for cache, health, logging, metrics, tracing and capacity math.

**Goal:** 在 NestJS + Prisma 只读链路上建立受控连接池、进程内缓存、健康检查、结构化日志、低基数指标、W3C trace context、可复现 loopback 负载测试，并给出日请求 10 万/100 万/1000 万三档的实测容量基线和扩容要求。

**Architecture:** 单进程只由 `@navigator/db` runtime 工厂创建一个 PrismaClient，Prisma v6 pool 通过受校验的连接 URL 参数限制。API 仅缓存已格式化的 200 成功响应并使用 single-flight；只有明确定类的暂时数据库不可用错误可触发短时 stale-if-error，不改变 JSON contract。观测仅使用 Node/Nest 内建能力：JSON stdout、AsyncLocalStorage、手写有界 metrics registry、loopback-only metrics server；不引入 Redis、APM、队列或真实 AI。压测器只允许本机只读 GET，原始结果存 ignored artifacts，结论写入版本化报告。

**Tech Stack:** NestJS 11、Prisma 6.19.3、PostgreSQL/pgvector、Node `AsyncLocalStorage`/`monitorEventLoopDelay`/`fetch`、Vitest。PLATFORM-API-1 以外不新增第三方依赖。

---

## 任务 1：连接池与单 client 生命周期

**Files:**

- Create: `apps/api/src/database/database-config.ts`
- Create: `apps/api/src/database/database-config.test.ts`
- Modify: `apps/api/src/runtime/country-read-runtime.provider.ts`
- Modify: `apps/api/src/main.ts`
- Modify: `packages/db/src/read/country-read-runtime.ts`
- Modify: `packages/db/src/country-read-runtime.test.ts`
- Modify: `apps/api/src/api-config.ts`
- Modify: `apps/api/src/api-config.test.ts`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 写 RED tests**

固定可选变量与默认值：

```text
DATABASE_POOL_MAX=10                 # 1..50
DATABASE_POOL_TIMEOUT_SECONDS=5      # 1..30
DATABASE_CONNECT_TIMEOUT_SECONDS=5   # 1..30
```

测试：

- 对 URL 安全增加 `connection_limit=10`、`pool_timeout=5`、`connect_timeout=5`、`application_name=navigator-api`。
- 原 URL 已含任一受管参数（包括 `application_name`，即便值相同）时 fail-fast，错误只含参数名，不含 URL；调用方不能覆盖固定 application name。
- 非 PostgreSQL URL、credentials/host/db 缺失和非法范围 fail closed。
- 一个 app 只创建一个 `CountryReadRuntime`；并发 provider 请求取得同一 repository；shutdown 只 close 一次。
- controller/repository/health 源码不得直接 `new PrismaClient()`。
- provider wiring 必须严格为 `validateApiEnv → buildDatabaseRuntimeConfig → createPrismaCountryReadRuntime({databaseUrl: managedUrl})`；factory spy 断言只收到受管 URL，原 env object/原始 URL 未被改写，logger/stdout/stderr 均无 URL。

**Step 2: 运行 RED**

```bash
pnpm --filter @navigator/api exec vitest run src/database
```

**Step 3: 实现并更新 env 三件套**

Prisma 6 的 URL 参数只在调用 `createPrismaCountryReadRuntime()` 前添加；原 `DATABASE_URL` 不修改、不日志输出。pool timeout 不允许 0，防止无界 FIFO 等待。默认 10 连接；若 PostgreSQL `max_connections=100` 且预留 20 条运维连接，则单实例池 10 时 API 副本硬上限为 8，部署配置不得超出。

**Step 4: 运行 GREEN 并提交**

```bash
pnpm --filter @navigator/api exec vitest run src/database
pnpm --filter @navigator/db exec vitest run src/country-read-runtime.test.ts
pnpm --filter @navigator/api typecheck
git add apps/api/src/database apps/api/src/runtime/country-read-runtime.provider.ts \
  apps/api/src/main.ts apps/api/src/api-config.ts \
  apps/api/src/api-config.test.ts packages/db/src/read/country-read-runtime.ts \
  packages/db/src/country-read-runtime.test.ts docs/env-config.md .env.example
git commit -m "feat(ops): bound Prisma connection pool"
```

## 任务 2：有界只读缓存、single-flight 与 stale 降级

**Files:**

- Create: `apps/api/src/ops/readonly-response-cache.ts`
- Create: `apps/api/src/ops/readonly-response-cache.test.ts`
- Create: `apps/api/src/ops/cache-key.ts`
- Create: `apps/api/src/ops/cache-key.test.ts`
- Modify: `apps/api/src/countries/countries.service.ts`
- Modify: `apps/api/src/countries/countries.controller.ts`
- Modify: `apps/api/src/api-config.ts`
- Modify: `apps/api/src/api-config.test.ts`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 写 RED tests**

固定配置：

```text
READ_CACHE_TTL_SECONDS=60             # 1..300
READ_CACHE_STALE_IF_ERROR_SECONDS=300 # 0..600
READ_CACHE_MAX_ENTRIES=1000           # 10..10000
```

固定接口：

```ts
export interface CachedRead<T> {
  readonly value: T;
  readonly state: "hit" | "miss" | "stale";
}

export interface CacheableHttpSuccess<T extends JsonValue> {
  readonly status: 200;
  readonly value: T;
}

export interface ReadonlyResponseCache {
  getOrLoad<T extends JsonValue>(
    key: string,
    loader: () => Promise<CacheableHttpSuccess<T>>,
  ): Promise<CachedRead<T>>;
  invalidateCountry(countryCode: string): void;
  clear(): void;
}
```

覆盖 fresh hit/miss、相同 key 并发 single-flight、不同 key 独立、loader 失败不缓存、60 秒后 `DatabaseUnavailableError`/受控 DB timeout 才返回 300 秒内 stale、超过 stale window 抛错、只缓存明确包装的 200、有界 LRU=1000、单条序列化 JSON 最大 1 MiB、总缓存最大 16 MiB、超大响应正常返回但不缓存、按字节和条目双重确定性淘汰、structured clone 防调用方改写、列表/详情/模块国家失效、`clear()`。

错误分类必须来自 DB runtime 的有限公开 taxonomy：`DatabaseUnavailableError`（连接/连接池超时/暂时不可达）可 stale；`DataIntegrityError`、`CountryNotFoundError`、validation/programmer/未知错误一律不可 stale。测试逐类证明不可用旧缓存掩盖坏数据、404 或代码缺陷。缓存值是 formatter 完成后的不可变 JSON body，不包含 response headers；每次 controller 都重新生成 request id、trace、content-type 与 cache/stale headers。

cache key 只由固定 route template 与已规范化 page/pageSize/filter/locale/textMode/code/moduleKey 组成；不接受原始 URL/header。country list key 归属全局，任何 country invalidation 都清除 list keys。

**Step 2: 实现并集成**

parser/validation 在进入 cache 前执行；repository 的 null 转换成 `CountryNotFoundError` 后才到 cache loader。成功响应加 `X-Navigator-Cache: hit|miss|stale`；stale 额外 `X-Navigator-Data-Stale: 1`，JSON body 不变。400/404/500 不缓存也不触发 stale。DB 无 stale 时保持现有 500 envelope，禁止静默 canonical fallback。

**Step 3: 运行、提交**

```bash
pnpm --filter @navigator/api exec vitest run \
  src/ops/readonly-response-cache.test.ts src/ops/cache-key.test.ts \
  src/countries
git add apps/api/src/ops apps/api/src/countries \
  apps/api/src/api-config.ts apps/api/src/api-config.test.ts \
  packages/db/src/read/country-read-runtime.ts \
  docs/env-config.md .env.example
git commit -m "feat(ops): cache bounded country reads"
```

## 任务 3：liveness/readiness 与安全错误边界

**Files:**

- Create: `apps/api/src/ops/health.controller.ts`
- Create: `apps/api/src/ops/health.service.ts`
- Create: `apps/api/src/ops/health.controller.test.ts`
- Create: `apps/api/src/ops/health.service.test.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `scripts/run-platform-e2e.mjs`
- Modify: `scripts/run-platform-e2e.test.mjs`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/api-contract.md`
- Modify: `apps/api/src/api-config.ts`
- Modify: `apps/api/src/api-config.test.ts`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 写 RED tests**

配置 `HEALTH_READY_TIMEOUT_MS=1000`，范围 100..5000。行为：

| Endpoint | Behavior |
|---|---|
| `GET /health/live` | 200 `{"status":"ok"}`；不访问 DB；`Cache-Control: no-store` |
| `GET /health/ready` | selected runtime 的 ping 在 1 秒内成功才 200 `{"status":"ready"}` |
| ready timeout/error | 503 `{"status":"not_ready"}`；不含底层错误 |

readiness 必须绕过 response cache；stale cache 存在也不得伪装 ready。database source 的 `CountryReadRuntime.ping()` 使用 Prisma interactive `$transaction`，同时设置 `maxWait=HEALTH_READY_TIMEOUT_MS`、`timeout=HEALTH_READY_TIMEOUT_MS`，事务内只执行 `$queryRaw` tagged template 的静态 `SELECT 1`；禁止 `Promise.race` 留下未取消的后台 query、Unsafe 或字符串拼接。测试用可控 client 证明超时后 transaction 已终止/连接已释放，连续 readiness 不积累 in-flight query。canonical source 不需要 `DATABASE_URL`，其 ping 只验证启动时已加载/批准/冻结的 publication snapshot；损坏 snapshot 必须在启动时失败，运行中 DB 故障不得使显式 rollback source 变为 not-ready。

同步修改 `docs/api-contract.md`：国家业务接口仍统一位于 `/api/v1`，明确仅 `GET /health/live` 与 `GET /health/ready` 是编排器根路径例外，metrics 仍在独立 loopback 端口且不属于业务 API。加入 contract 文档守卫，防止实现与规范再次冲突。

真实 HTTP controller test 在随机 loopback port 分别断言裸路径 live/ready、`/api/v1/health/*` 为 404、database/canonical source-aware readiness 和 no-store。随后把平台 E2E orchestrator 的 API 启动探针从 countries 升级为 `/health/ready`；测试证明 503/timeout/非 JSON 时不启动 Web，CI E2E 继续跑完整链。

**Step 2: 实现、运行、提交**

```bash
pnpm --filter @navigator/api exec vitest run \
  src/ops/health.service.test.ts src/ops/health.controller.test.ts
node --test scripts/run-platform-e2e.test.mjs
git add apps/api/src/ops/health* apps/api/src/app.module.ts \
  apps/api/src/api-config.ts apps/api/src/api-config.test.ts \
  packages/db/src/read/country-read-runtime.ts docs/api-contract.md \
  docs/env-config.md .env.example scripts/run-platform-e2e.mjs \
  scripts/run-platform-e2e.test.mjs .github/workflows/ci.yml
git commit -m "feat(ops): add API health probes"
```

## 任务 4：request context、JSON 日志与 W3C trace

**Files:**

- Create: `apps/api/src/ops/request-context.ts`
- Create: `apps/api/src/ops/request-context.test.ts`
- Create: `apps/api/src/ops/json-logger.ts`
- Create: `apps/api/src/ops/json-logger.test.ts`
- Create: `apps/api/src/ops/observability.interceptor.ts`
- Create: `apps/api/src/ops/observability.interceptor.test.ts`
- Modify: `apps/api/src/main.ts`

**Step 1: 写 RED tests**

- 合法 W3C `traceparent` 保留 trace id 并生成新 span id；畸形值全部替换。
- 合法 `x-request-id` 只允许 16..64 位 `[A-Za-z0-9_-]`；否则生成 UUID。
- AsyncLocalStorage 在 await、repository、cache、logger 中保持同一 context，不跨请求泄漏。
- 每个请求恰好一行 JSON，字段 allowlist：timestamp、level、event、requestId、traceId、spanId、method、route、status、durationMs、cacheState、errorCode。
- route 必须是模板，不记录原始 path/query、country code、IP、user-agent、cookie、authorization、DATABASE_URL、异常 message/stack 或联系信息。

**Step 2: 实现并接入全局 interceptor**

响应加安全的 `x-request-id` 与 `traceparent`。500 日志只记 `errorCode=INTERNAL_ERROR` 和内部分类枚举，不记录 exception message。

**Step 3: 运行、提交**

```bash
pnpm --filter @navigator/api exec vitest run \
  src/ops/request-context.test.ts src/ops/json-logger.test.ts \
  src/ops/observability.interceptor.test.ts
git add apps/api/src/ops apps/api/src/main.ts
git commit -m "feat(ops): add safe request tracing and logs"
```

## 任务 5：低基数指标与 loopback-only metrics server

**Files:**

- Create: `apps/api/src/ops/metrics-registry.ts`
- Create: `apps/api/src/ops/metrics-registry.test.ts`
- Create: `apps/api/src/ops/metrics-server.ts`
- Create: `apps/api/src/ops/metrics-server.test.ts`
- Modify: `apps/api/src/ops/observability.interceptor.ts`
- Modify: `apps/api/src/ops/readonly-response-cache.ts`
- Modify: `apps/api/src/countries/countries.service.ts`
- Modify: `apps/api/src/api-config.ts`
- Modify: `apps/api/src/api-config.test.ts`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 写 RED tests**

配置 `METRICS_PORT=9464`（1024..65535）。server 必须显式 bind `127.0.0.1`，只接受 `GET /metrics`，其他 path/method 404/405，shutdown 关闭一次。固定指标：

```text
navigator_http_requests_total{method,route,status}
navigator_http_request_duration_seconds{method,route}
navigator_http_errors_total{route,error_code}
navigator_cache_requests_total{route,state}
navigator_cache_stale_responses_total{route}
navigator_db_operation_duration_seconds{operation}
navigator_db_operations_in_flight{operation}
navigator_process_cpu_seconds_total
navigator_process_resident_memory_bytes
navigator_event_loop_lag_seconds
navigator_process_cpu_capacity_cores
navigator_process_memory_limit_bytes
```

label allowlist 只含固定 method/route template/status/error/cache/operation 枚举；测试输入 ID/VN/任意 query/requestId 不增加 series。直方图 buckets 固定并有上界；registry 不能随用户值增长。

`db_operations_in_flight` 明确叫逻辑操作，不冒充真实连接数；真实连接水位由 benchmark PostgreSQL `pg_stat_activity` 采集。CPU capacity 与 memory limit 在 Linux 优先解析 cgroup v2 `/sys/fs/cgroup/cpu.max`、`memory.max`，`max` 时回退 `os.availableParallelism()`/host memory，并把来源写入 benchmark environment artifact；parser 使用 fixture 测试，不把不存在/畸形 cgroup 文件解释成 0。

**Step 2: 实现、运行、提交**

```bash
pnpm --filter @navigator/api exec vitest run \
  src/ops/metrics-registry.test.ts src/ops/metrics-server.test.ts \
  src/ops/observability.interceptor.test.ts
git add apps/api/src/ops apps/api/src/countries \
  apps/api/src/api-config.ts apps/api/src/api-config.test.ts \
  docs/env-config.md .env.example
git commit -m "feat(ops): expose bounded loopback metrics"
```

## 任务 6：确定性容量模型

**Files:**

- Create: `apps/api/src/ops/capacity-model.ts`
- Create: `apps/api/src/ops/capacity-model.test.ts`

**Step 1: 写 RED math tests**

固定 M1 假设：

```ts
const M1_CAPACITY_ASSUMPTIONS = {
  peakHourShare: 0.10,
  surgeFactor: 2,
  readRatio: 1,
  writeRatio: 0,
  cacheHitRatio: 0.80,
  aiShare: 0,
} as const;
```

公式：

```text
averageRps = dailyRequests / 86400
peakRps = ceil(dailyRequests * peakHourShare * surgeFactor / 3600)
dbRps = peakRps * (readRatio * (1 - cacheHitRatio) + writeRatio)
```

精确断言：

| 日请求 | 平均 RPS | 峰值 RPS | 估算 DB RPS |
|---:|---:|---:|---:|
| 100,000 | 1.1574 | 6 | 1.2 |
| 1,000,000 | 11.5741 | 56 | 11.2 |
| 10,000,000 | 115.7407 | 556 | 111.2 |

非法 daily、比例和非有限值 fail closed；模型不得 import AI、fetch、DB 或环境。

**Step 2: 实现、运行、提交**

```bash
pnpm --filter @navigator/api exec vitest run src/ops/capacity-model.test.ts
git add apps/api/src/ops/capacity-model.ts apps/api/src/ops/capacity-model.test.ts
git commit -m "feat(ops): define M1 capacity model"
```

## 任务 7：loopback-only 负载测试器

**Files:**

- Create: `apps/api/scripts/read-only-load-scenarios.json`
- Create: `apps/api/scripts/load-read-only.mjs`
- Create: `apps/api/scripts/load-read-only.test.mjs`
- Create: `apps/api/scripts/collect-pg-connections.mjs`
- Create: `apps/api/scripts/collect-pg-connections.test.mjs`
- Create: `apps/api/scripts/capture-benchmark-environment.mjs`
- Create: `apps/api/scripts/capture-benchmark-environment.test.mjs`
- Modify: `apps/api/package.json`
- Modify: `.gitignore`

**Step 1: 写 RED runner tests**

只允许字面量 base URL `http://127.0.0.1:*` 或 `http://[::1]:*`；不接受 `localhost` 或任何需要 DNS 的 hostname。credentials、非 http、非 loopback、path/query/hash 全拒绝。每次 fetch 固定 `redirect: "manual"`，任何 3xx 都使场景失败，不跟随 Location。请求矩阵固定 seed：60% list、30% detail、10% module（其中一半 market overview、一半 BUILDING），六国与两种 locale 均衡；只发 GET，不访问 AI、写接口或外网。

runner 使用版本化 scenario 文件中的固定目标 RPS、bounded concurrency、warm-up 与 measurement window：

```json
{
  "100k": { "targetRps": 6, "maxConcurrency": 16, "warmupSeconds": 120, "measurementSeconds": 600 },
  "1m": { "targetRps": 56, "maxConcurrency": 128, "warmupSeconds": 120, "measurementSeconds": 600 },
  "10m": { "targetRps": 556, "maxConcurrency": 1024, "warmupSeconds": 120, "measurementSeconds": 600 }
}
```

每秒样本记录 achieved RPS、status、latency histogram、cache headers；另接受并严格校验 loopback-only `--metrics-url http://127.0.0.1:9464/metrics`，每秒抓取 API 指标，以 CPU counter 差分计算 API CPU、而不是误报负载发生器自身资源。输出 JSON：git SHA、scenario 文件 SHA-256、image digest、Node/Prisma/Postgres 版本、CPU/RAM/cgroup source、requested/achieved RPS、count、p50/p95/p99、2xx/4xx/5xx、cache hit/miss/stale、API RSS、API CPU、API event-loop lag。原始文件不得提交。

`collect-pg-connections.mjs` 只接受固定容器名 `navigator-platform-ops-1-postgres` 和 ignored output path，内部使用 Node `spawn` 执行参数数组形式的 `docker exec`；SQL 是源码中固定的 `pg_stat_activity` 聚合，只筛选 `application_name='navigator-api'`，每秒输出 timestamp/active/idle/total JSONL。拒绝任意其他容器名、SQL、hostname 或命令片段；测试证明无 shell、无动态 SQL、停止信号后等待子进程退出。

`capture-benchmark-environment.mjs` 同样只接受该固定容器名与 ignored output path，用参数数组调用 `git rev-parse`、`node --version`、`pnpm exec prisma --version`、`docker inspect` 与容器内静态 PostgreSQL version 查询；复用 metrics cgroup parser，写出 git SHA、scenario SHA-256、实际 image ID/digest、版本、CPU/RAM/cgroup limit/source 和非敏感配置（pool/cache/端口）。禁止写入 DATABASE_URL、credentials、完整 env 或命令行 secret。fixture tests 固定字段、脱敏与失败行为。

**Step 2: 实现与静态安全测试**

```bash
node --test apps/api/scripts/load-read-only.test.mjs \
  apps/api/scripts/collect-pg-connections.test.mjs \
  apps/api/scripts/capture-benchmark-environment.test.mjs
```

**Step 3: 新增 script 与 ignore**

```json
"load:readonly": "node scripts/load-read-only.mjs"
```

`.gitignore` 增加 `/artifacts/platform-ops/`。

**Step 4: 提交**

```bash
git add apps/api/scripts apps/api/package.json .gitignore
git commit -m "test(ops): add safe read-only load runner"
```

## 任务 8：隔离 PostgreSQL 实测与服务器要求报告

**Files:**

- Create: `docs/platform-ops-baseline.md`
- Raw output only: `artifacts/platform-ops/{environment.json,api.log,pg-connections.jsonl,100k.json,1m.json,10m.json,manifest.sha256}` (ignored)

**Step 1: 建立隔离环境**

使用以下完整 harness。它只操作精确命名的临时容器/进程；若同名容器或端口已被占用则直接失败，不复用也不停止未知资源。禁止生产凭证和破坏性生产命令：

```bash
set -euo pipefail

if docker container inspect navigator-platform-ops-1-postgres >/dev/null 2>&1; then
  exit 1
fi

mkdir -p artifacts/platform-ops
navigator_ops_api_pid=""
navigator_ops_collector_pid=""
navigator_ops_container_started="false"

navigator_ops_cleanup() {
  if [ -n "$navigator_ops_collector_pid" ]; then
    kill -TERM "$navigator_ops_collector_pid" 2>/dev/null || true
    wait "$navigator_ops_collector_pid" 2>/dev/null || true
    navigator_ops_collector_pid=""
  fi
  if [ -n "$navigator_ops_api_pid" ]; then
    kill -TERM "$navigator_ops_api_pid" 2>/dev/null || true
    wait "$navigator_ops_api_pid" 2>/dev/null || true
    navigator_ops_api_pid=""
  fi
  if [ "$navigator_ops_container_started" = "true" ]; then
    docker stop navigator-platform-ops-1-postgres >/dev/null || true
    navigator_ops_container_started="false"
  fi
}
trap navigator_ops_cleanup EXIT INT TERM

docker run --detach --rm \
  --name navigator-platform-ops-1-postgres \
  --publish 127.0.0.1:55434:5432 \
  --env POSTGRES_USER=navigator_test \
  --env POSTGRES_PASSWORD=navigator_test_only \
  --env POSTGRES_DB=navigator_platform_db_1_test \
  pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0
navigator_ops_container_started="true"

for navigator_ops_attempt in $(seq 1 30); do
  if docker exec navigator-platform-ops-1-postgres \
    pg_isready --host 127.0.0.1 \
      --username navigator_test --dbname navigator_platform_db_1_test
  then
    break
  fi
  if [ "$navigator_ops_attempt" -eq 30 ]; then exit 1; fi
  sleep 1
done

DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55434/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma generate --schema prisma/schema.prisma
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55434/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma migrate deploy --schema prisma/schema.prisma
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55434/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec vitest run \
    src/approved-basic-countries-postgres.integration.test.ts

navigator_ops_counts=$(docker exec navigator-platform-ops-1-postgres \
  psql --username navigator_test --dbname navigator_platform_db_1_test \
  --tuples-only --no-align --command \
  'SELECT (SELECT count(*) FROM countries), (SELECT count(*) FROM module_coverages), (SELECT count(*) FROM market_overviews), (SELECT count(*) FROM knowledge_chunks);')
if [ "$navigator_ops_counts" != "6|60|6|0" ]; then exit 1; fi

pnpm --filter @navigator/api build
API_PORT=3100 \
COUNTRY_READ_SOURCE=database \
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55434/navigator_platform_db_1_test \
DATABASE_POOL_MAX=10 \
DATABASE_POOL_TIMEOUT_SECONDS=5 \
DATABASE_CONNECT_TIMEOUT_SECONDS=5 \
READ_CACHE_TTL_SECONDS=60 \
READ_CACHE_STALE_IF_ERROR_SECONDS=300 \
READ_CACHE_MAX_ENTRIES=1000 \
HEALTH_READY_TIMEOUT_MS=1000 \
METRICS_PORT=9464 \
NODE_ENV=production \
  node apps/api/dist/main.js >artifacts/platform-ops/api.log 2>&1 &
navigator_ops_api_pid=$!

for navigator_ops_attempt in $(seq 1 60); do
  if ! kill -0 "$navigator_ops_api_pid" 2>/dev/null; then exit 1; fi
  navigator_ops_ready=$(curl --noproxy '*' \
    --fail --silent --show-error --max-time 2 \
    http://127.0.0.1:3100/health/ready 2>/dev/null || true)
  if [ "$navigator_ops_ready" = '{"status":"ready"}' ]; then break; fi
  if [ "$navigator_ops_attempt" -eq 60 ]; then exit 1; fi
  sleep 1
done

curl --noproxy '*' --fail --silent --show-error --max-time 2 \
  http://127.0.0.1:9464/metrics | \
  rg '^navigator_process_cpu_seconds_total '

node apps/api/scripts/capture-benchmark-environment.mjs \
  --container navigator-platform-ops-1-postgres \
  --scenario apps/api/scripts/read-only-load-scenarios.json \
  --output artifacts/platform-ops/environment.json

node apps/api/scripts/collect-pg-connections.mjs \
  --container navigator-platform-ops-1-postgres \
  --output artifacts/platform-ops/pg-connections.jsonl &
navigator_ops_collector_pid=$!
```

DB integration test 自身负责“空库 → 六国导入两次 → 6/60/6/深层 0 → 逐国 canonical 等价 → 合成失败回滚”；外层再检查 6/60/6/knowledge 0。API 与 metrics 都只 bind loopback，pool=10，AI share/write=0。

**Step 2: 运行三档测量**

每档 warm-up 120 秒、measurement 600 秒：

```bash
pnpm --filter @navigator/api load:readonly \
  --base-url http://127.0.0.1:3100 \
  --metrics-url http://127.0.0.1:9464/metrics \
  --scenario 100k --output ../../artifacts/platform-ops/100k.json
pnpm --filter @navigator/api load:readonly \
  --base-url http://127.0.0.1:3100 \
  --metrics-url http://127.0.0.1:9464/metrics \
  --scenario 1m --output ../../artifacts/platform-ops/1m.json
pnpm --filter @navigator/api load:readonly \
  --base-url http://127.0.0.1:3100 \
  --metrics-url http://127.0.0.1:9464/metrics \
  --scenario 10m --output ../../artifacts/platform-ops/10m.json
```

三个场景完成后必须按以下顺序停止并固化证据：

```bash
kill -TERM "$navigator_ops_collector_pid"
wait "$navigator_ops_collector_pid"
navigator_ops_collector_pid=""

kill -TERM "$navigator_ops_api_pid"
wait "$navigator_ops_api_pid"
navigator_ops_api_pid=""

docker stop navigator-platform-ops-1-postgres >/dev/null
navigator_ops_container_started="false"

sha256sum \
  artifacts/platform-ops/environment.json \
  artifacts/platform-ops/api.log \
  artifacts/platform-ops/pg-connections.jsonl \
  artifacts/platform-ops/100k.json \
  artifacts/platform-ops/1m.json \
  artifacts/platform-ops/10m.json \
  >artifacts/platform-ops/manifest.sha256

trap - EXIT INT TERM
```

三个场景开始前启动受控 collector，并行每秒从隔离 PostgreSQL 采集 `pg_stat_activity` 中 `application_name='navigator-api'` 的连接峰值；三个场景结束后发送停止信号并等待 collector flush/退出。另将 `docker inspect` 得到的实际 image digest、API/DB 启动命令的非敏感配置、分配的 vCPU/RAM/cgroup source、git SHA、scenario config SHA-256 写入 `environment.json`。生成 `manifest.sha256` 覆盖所有 raw artifacts；报告命令与结果，不提交 credentials。

**Step 3: 判定每档，不美化失败**

通过阈值：achieved RPS ≥ 目标 95%；5xx < 0.1%；p95 < 150ms；p99 < 300ms；稳态 cache hit ≥80%；event-loop p99 <50ms；API 真实 DB 连接峰值 ≤7/10；CPU p95 ≤分配 CPU 70%；RSS ≤分配 RAM 75%。任一失败则该档标为“未承载”，记录首个瓶颈与横向扩容触发点。

**Step 4: 写服务器要求表**

`docs/platform-ops-baseline.md` 必须同时包含：

- 实测环境与原始 artifact SHA-256。
- git SHA、scenario config hash、实际容器 image digest 与每个 raw artifact 的 SHA-256；任一缺失则该轮不得标为已独立验证。
- 三档假设、实测 p95/p99/error/cache/CPU/RAM/connection。
- 单实例已验证容量，不能用模型值冒充实测。
- 建议 API 实例数、每实例 vCPU/RAM、DB vCPU/RAM/磁盘/连接预算、负载均衡、备份/恢复、TLS/WAF/CDN要求。
- 多实例时 Redis/外部 pooler/APM 仅列为进入条件，明确它们尚未获批/实施。
- AI share=0；未来 AI Beta 必须单独做模型/向量/队列容量测试，不能套用本表。

**Step 5: 提交版本化报告**

```bash
git add docs/platform-ops-baseline.md
git commit -m "docs(ops): record M1 capacity baseline"
```

## 任务 9：降级、失效与完整验收

**Step 1: 故障演练**

在隔离环境验证：DB 暂停时 fresh/stale/no-cache 三条路径；TTL 到期；country invalidation；API 优雅关闭；pool timeout；readiness 503 但 liveness 200；恢复 DB 后 miss 重新填充。不得模拟为成功后宣称真实故障已测。

**Step 2: 完整验证**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
node --test apps/api/scripts/load-read-only.test.mjs \
  apps/api/scripts/collect-pg-connections.test.mjs \
  apps/api/scripts/capture-benchmark-environment.test.mjs
git diff --check main...HEAD
```

**Step 3: 独立 reviewer**

review package 除 commit diff 外必须附上 ignored raw artifact 的绝对路径、manifest 内容、git SHA、scenario hash 和 image digest；reviewer 从 shared filesystem 重新计算 hash，并抽查每秒样本、PostgreSQL 连接 JSONL 与报告数字。缺任一 artifact 或 hash 不得接受“实测通过”。

必须核验：pool 总预算、一个 PrismaClient、缓存有界/single-flight/stale 边界、health 不泄密、日志/metrics 低基数、metrics 仅 loopback、负载 runner 不可访问外网/写/AI、原始结果真实且报告可复现。修复所有 Critical/Important 后按既定路径合并 `main`、验证 merged-main、推送并观察 CI。
