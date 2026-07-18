# PLATFORM-DB-1 六国生产数据读写底座实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to execute this plan task-by-task, and use `superpowers:test-driven-development` for every behavior change.

**Goal:** 将仓库中六个已批准 BASIC publication 通过现有 Prisma schema 幂等写入 PostgreSQL，并在每国事务提交前从数据库回读、重建 canonical 结构并证明完全等价。

**Architecture:** approved publication loader 仍是唯一可信输入边界；文件验证与六国输入准备全部在事务外完成。每个国家使用一笔短事务执行“深层数据 preflight → 12 个 upsert → 数据库回读 → canonical 深度等价断言”，任一步失败都回滚该国。批处理按目录稳定排序串行执行，不硬编码国家名单，不写入 staging、approval、audit 或 KnowledgeChunk。

**Tech Stack:** TypeScript strict、Prisma 6.19.3、PostgreSQL、Vitest、Node 内建 `util.isDeepStrictEqual`。不新增依赖，不修改 `docs/data-schema.md` 或 `schema.prisma`。

---

## 任务 1：冻结单次可信 publication 输入

**Files:**

- Modify: `packages/db/src/seed/approved-basic-country-import.ts`
- Modify: `packages/db/src/seed/approved-basic-publications-validation.ts`
- Modify: `packages/db/src/approved-basic-country-import.test.ts`
- Modify: `packages/db/src/approved-basic-publications-validation.test.ts`

**Step 1: 先写失败测试**

新增断言：

```ts
test("prepares canonical and plan from one approved publication snapshot", () => {
  let loads = 0;
  const prepared = prepareApprovedBasicCountryImport(
    REPO_ROOT,
    "indonesia",
    (...args) => {
      loads += 1;
      return loadApprovedBasicCountryPublicationV2(...args);
    },
  );

  expect(loads).toBe(1);
  expect(prepared.countryDirectory).toBe("indonesia");
  expect(prepared.countryCode).toBe("ID");
  expect(prepared.plan.operations).toHaveLength(12);
  expect(prepared.canonical.country.code).toBe("ID");
});
```

在 publication validation 测试中新增目录发现断言，并证明 `approvals`、`staging`、隐藏目录和符号链接仍被拒绝或排除。

**Step 2: 运行测试并确认 RED**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/approved-basic-country-import.test.ts \
  src/approved-basic-publications-validation.test.ts
```

Expected: 因 `prepareApprovedBasicCountryImport` 与 `discoverApprovedBasicCountryDirectories` 尚不存在而失败。

**Step 3: 实现最小可信输入结构**

在 `approved-basic-country-import.ts` 增加：

```ts
export interface PreparedApprovedBasicCountryImport {
  readonly countryDirectory: string;
  readonly countryCode: string;
  readonly canonical: BasicCanonicalData;
  readonly plan: BasicCountryImportPlan;
}

export function prepareApprovedBasicCountryImport(
  repoRoot: string,
  countryDirectory: string,
  loadPublication: typeof loadApprovedBasicCountryPublicationV2 =
    loadApprovedBasicCountryPublicationV2,
): PreparedApprovedBasicCountryImport;
```

函数必须只调用 loader 一次，从同一返回值同时构建 `canonical` 与 `plan`；现有 `buildApprovedBasicCountryPublicationImportPlan()` 改为调用该函数并只返回 `.plan`，保持 CLI 与公开 API 兼容。

`PreparedApprovedBasicCountryImport` 不能只靠 TypeScript 结构类型充当可信边界。模块内部维护不可导出的 `WeakSet<object>` 作为运行时品牌；prepare 成功后递归冻结 `canonical`、`plan`、operations 与顶层对象，再加入 WeakSet。任务 2 的执行器只接受 WeakSet 中、仍保持冻结且核心摘要未变化的实例；结构相同的 clone、解冻/改写对象或外部手工构造对象统一抛固定码 `BASIC_IMPORT_UNTRUSTED_PREPARATION`，并且在拒绝前不得调用 transaction port。

同一 preparation module 导出 package-internal guard `isPreparedApprovedBasicCountryImportFromLoader(value: unknown): value is PreparedApprovedBasicCountryImport`；它只查询私有 WeakSet 并复核深度冻结，不暴露集合或品牌写入口。runtime 模块必须调用该 guard，禁止复制一个永远访问不到私有 WeakSet 的形状校验。

在 `approved-basic-publications-validation.ts` 提取并导出：

```ts
export function discoverApprovedBasicCountryDirectories(
  repoRoot: string,
): readonly string[];
```

它只负责安全目录发现；原 `validateApprovedBasicCountryPublications()` 复用它并继续逐个通过 loader 验证。

**Step 4: 运行 GREEN 与类型检查**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/approved-basic-country-import.test.ts \
  src/approved-basic-publications-validation.test.ts
pnpm --filter @navigator/db typecheck
```

Expected: 两个测试文件全部通过，类型检查退出码 0。

**Step 5: 提交**

```bash
git add packages/db/src/seed/approved-basic-country-import.ts \
  packages/db/src/seed/approved-basic-publications-validation.ts \
  packages/db/src/approved-basic-country-import.test.ts \
  packages/db/src/approved-basic-publications-validation.test.ts
git commit -m "refactor(db): prepare approved BASIC imports once"
```

## 任务 2：实现国家级原子导入领域执行器

**Files:**

- Create: `packages/db/src/runtime/basic-country-import-runtime.ts`
- Create: `packages/db/src/basic-country-import-runtime.test.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: 先写内存事务 RED 测试**

测试使用可回滚的内存 state，不 mock publication loader。覆盖：

```ts
interface BasicCountryImportTransaction {
  readonly activationCounts: BasicActivationCountPort;
  execute(operation: BasicSeedImportOperation): Promise<void>;
  readCanonical(countryCode: string): Promise<BasicCanonicalData | null>;
}

interface BasicCountryImportTransactionPort {
  transaction<T>(
    run: (transaction: BasicCountryImportTransaction) => Promise<T>,
  ): Promise<T>;
}
```

- 正常输入恰好在一笔事务内执行 12 个 operation。
- 12 个 operation 必须严格为 1 个 Country、按 `MODULE_KEYS` 唯一且有序的 10 个 ModuleCoverage、1 个 MarketOverview；国家码、模块码与 operation countryCode 全部一致。
- preflight 发现任一深层记录时抛出稳定码 `BASIC_IMPORT_LEGACY_DATA_PRESENT`，执行 0 次 upsert。
- 第 N 个 upsert 失败时 state 恢复到事务前快照。
- 回读为 `null` 或与 canonical 不等价时抛出 `BASIC_IMPORT_READBACK_MISMATCH` 并回滚。
- 第二次导入相同输入后 state 仍为 1 个 Country、10 个 coverage、1 个 MarketOverview。
- 结果只含 `countryCode` 与 `operationCount`，序列化后不含 approval/staging/audit/KnowledgeChunk sentinel。
- clone、手工伪造或 prepare 后被篡改的输入抛 `BASIC_IMPORT_UNTRUSTED_PREPARATION`，transaction 调用次数为 0。

**Step 2: 运行测试并确认 RED**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-country-import-runtime.test.ts
```

Expected: 模块不存在而失败。

**Step 3: 实现执行器**

导出：

```ts
export interface BasicCountryImportResult {
  readonly countryCode: string;
  readonly operationCount: number;
}

export async function importPreparedApprovedBasicCountry(
  prepared: PreparedApprovedBasicCountryImport,
  port: BasicCountryImportTransactionPort,
): Promise<BasicCountryImportResult>;
```

同时导出稳定错误类型与有限错误码 union，例如：

```ts
export class BasicCountryImportError extends Error {
  readonly code: BasicCountryImportErrorCode;

  constructor(code: BasicCountryImportErrorCode, options?: ErrorOptions) {
    super(code, options);
    this.name = "BasicCountryImportError";
    this.code = code;
  }
}
```

事务体固定为：

```ts
const preflight = await preflightBasicCountryActivation(
  prepared.countryCode,
  transaction.activationCounts,
);
if (!preflight.valid) {
  throw new BasicCountryImportError("BASIC_IMPORT_PREFLIGHT_FAILED");
}
if (preflight.activation !== "ready") {
  throw new BasicCountryImportError("BASIC_IMPORT_LEGACY_DATA_PRESENT");
}
for (const operation of prepared.plan.operations) {
  await transaction.execute(operation);
}
const actual = await transaction.readCanonical(prepared.countryCode);
if (actual === null || !isDeepStrictEqual(actual, prepared.canonical)) {
  throw new BasicCountryImportError("BASIC_IMPORT_READBACK_MISMATCH");
}
```

在进入事务前先通过 package-internal guard 验证运行时品牌与深度冻结状态，再 fail closed 校验 `countryCode`、BASIC summary、空 `aiEligibleKnowledgeIds`、operation 精确形状/国家码/模块码/顺序。transaction port、preflight、execute 或 readCanonical 抛出的任意未知异常必须在事务外统一映射为 `BASIC_IMPORT_DATABASE_OPERATION_FAILED`，以 `cause` 保留给受控内部诊断但公开 message 只有稳定码；只有 `BasicCountryImportError` 实例保持原码，禁止按任意 error message 猜测错误类型。测试逐一断言 class、code、message 与未知异常映射，不拼接 canonical、SQL、URL 或底层异常。

**Step 4: 运行 GREEN**

```bash
pnpm --filter @navigator/db exec vitest run src/basic-country-import-runtime.test.ts
pnpm --filter @navigator/db typecheck
```

**Step 5: 提交**

```bash
git add packages/db/src/runtime/basic-country-import-runtime.ts \
  packages/db/src/basic-country-import-runtime.test.ts packages/db/src/index.ts
git commit -m "feat(db): add atomic BASIC import runtime"
```

## 任务 3：实现 Prisma 事务适配器与数据库 canonical 回读

**Files:**

- Create: `packages/db/src/runtime/prisma-basic-country-import-port.ts`
- Create: `packages/db/src/runtime/prisma-basic-country-read.ts`
- Create: `packages/db/src/prisma-basic-country-import-port.test.ts`
- Create: `packages/db/src/prisma-basic-country-read.test.ts`
- Modify: `packages/db/src/index.ts`

**Step 1: 先写 RED 测试**

使用结构化 fake Prisma transaction，覆盖：

- `country → 10 moduleCoverage → marketOverview` 的 delegate/参数映射。
- `Region`、`ModuleKey`、coverage/status/credibility/review/tag 枚举在运行时 fail closed，不用 `any` 或不受控强转。
- `$transaction` 使用 `Serializable`、`maxWait=5000`、`timeout=15000`。
- 同一 client 生命周期内不创建第二个 `PrismaClient`。
- 回读将 Prisma 大写枚举逆映射为共享枚举，Date 转 ISO 字符串，coverage 按 `MODULE_KEYS` 重排。
- 六国 fake state 回读与各自 `prepared.canonical` 深度相等。
- 缺一条 coverage、重复 coverage、错误 JSON LocalizedText、`aiUsable=true`、非 published、出现任一深层/knowledge 记录时返回稳定失败，不把异常数据交给 API。

**Step 2: 运行并确认 RED**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/prisma-basic-country-import-port.test.ts \
  src/prisma-basic-country-read.test.ts
```

**Step 3: 实现 Prisma adapter**

`createPrismaBasicCountryImportPort(prismaClient)` 只在 `$transaction` callback 内创建 transaction adapter。`execute()` 对 discriminated union 做穷尽 `switch`，每个分支显式重建 Prisma 参数并用枚举解析函数验证字符串；禁止 raw SQL。

`readPrismaBasicCanonicalCountry(transaction, countryCode)` 使用一个 `country.findUnique`（包含 `moduleCoverage`、`marketOverview` 和所有深层关系）重建 `BasicCanonicalData`。BASIC 下所有深层关系必须为空，`entryStrategy=null`，knowledge 为空；随后复用 Basic validator 的核心不变量并返回冻结快照。

**Step 4: 运行 GREEN 与 schema 校验**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/prisma-basic-country-import-port.test.ts \
  src/prisma-basic-country-read.test.ts
pnpm --filter @navigator/db prisma:validate
pnpm --filter @navigator/db typecheck
```

**Step 5: 提交**

```bash
git add packages/db/src/runtime/prisma-basic-country-import-port.ts \
  packages/db/src/runtime/prisma-basic-country-read.ts \
  packages/db/src/prisma-basic-country-import-port.test.ts \
  packages/db/src/prisma-basic-country-read.test.ts packages/db/src/index.ts
git commit -m "feat(db): add Prisma BASIC import and readback adapter"
```

## 任务 4：实现六国串行批处理与安全 CLI

**Files:**

- Create: `packages/db/src/seed/approved-basic-countries-prisma-import.ts`
- Create: `packages/db/src/seed/approved-basic-countries-prisma-import-cli.ts`
- Create: `packages/db/src/approved-basic-countries-prisma-import.test.ts`
- Create: `packages/db/src/approved-basic-countries-prisma-import-cli.test.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`
- Modify: `tests/node-ts-source-commands.test.ts`

**Step 1: 写 RED 测试**

覆盖：

- `prepareAllApprovedBasicCountryImports(repoRoot)` 在任何 DB 调用前完成六国 loader 验证。
- 当前自动发现顺序为 BR、ID、SA、ZA、AE、VN，不在生产源代码内联名单。
- `importAllApprovedBasicCountries()` 串行逐国，禁止 `Promise.all`。
- 中间失败时失败国家事务无半成品、后续国家未启动、此前国家保留且可通过幂等重试收敛。
- CLI `--help`/非法参数不构造 client；正常执行只创建一个 client，finally 仅 disconnect 一次。
- client 构造、导入或 disconnect 失败时 stderr 只输出 `BASIC_IMPORT_FAILED`，不含连接串、SQL、路径或原始异常。
- 当前六国 fixture 的输出恰好为 `countryCount=6`、`operationCount=72`；生产实现不得硬编码这两个数字。

**Step 2: 运行 RED**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/approved-basic-countries-prisma-import.test.ts \
  src/approved-basic-countries-prisma-import-cli.test.ts
```

**Step 3: 实现批处理与脚本**

新增 package script：

```json
"import:approved-basic-publications": "node --experimental-transform-types --import ../../scripts/node-ts-source-hook.mjs src/seed/approved-basic-countries-prisma-import-cli.ts"
```

成功 stdout 由实际 results 计算，只输出：

```json
{"status":"ok","countryCount":6,"operationCount":72}
```

其中示例数字是当前六国验收值；`countryCount = results.length`，`operationCount = sum(result.operationCount)`。批处理必须先完成全部目录发现、loader 验证与 prepare，随后才允许构造/调用数据库 port，避免第七国未来加入时形成部分写入。

原 `seed:approved-basic-country` 保留为只打印 plan 的审计命令，不改名冒充写库。
`tests/node-ts-source-commands.test.ts` 除检查 script 字符串外，还必须通过 CLI 注入点运行 fake client 的成功路径，证明真实 Node flags 能加载 runtime、输出动态 6/72 并只 disconnect 一次；不得只靠 Vitest import 掩盖 Node type-stripping 差异。

**Step 4: 运行 GREEN**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/approved-basic-countries-prisma-import.test.ts \
  src/approved-basic-countries-prisma-import-cli.test.ts
pnpm exec vitest run tests/node-ts-source-commands.test.ts
```

**Step 5: 提交**

```bash
git add packages/db/src/seed/approved-basic-countries-prisma-import.ts \
  packages/db/src/seed/approved-basic-countries-prisma-import-cli.ts \
  packages/db/src/approved-basic-countries-prisma-import.test.ts \
  packages/db/src/approved-basic-countries-prisma-import-cli.test.ts \
  packages/db/package.json packages/db/src/index.ts \
  tests/node-ts-source-commands.test.ts
git commit -m "feat(db): import all approved BASIC publications"
```

## 任务 5：隔离 PostgreSQL 集成验收

**Files:**

- Create: `packages/db/src/approved-basic-countries-postgres.integration.test.ts`
- Modify: `docs/testing.md`
- Modify: `.github/workflows/ci.yml`

**Step 1: 写条件式集成测试**

测试只接受测试进程显式注入的 `DATABASE_URL`，并在连接前解析 URL、只允许字面量
`127.0.0.1` / `[::1]` host（Node `URL.hostname` 对 IPv6 保留方括号）；不接受 `localhost` 或任何需要 DNS 的 hostname，并要求数据库名精确为 `navigator_platform_db_1_test`。未提供时使用 `describe.skip` 并输出固定跳过原因。
不登记第二个数据库变量，也不从开发 `.env` 隐式加载。测试必须：

1. 断言外层已应用 `0001_init` migration，并在导入前断言所有业务表都为 0；测试本身不执行 migration。
2. 执行六国批导入两次。
3. 断言 Country=6、ModuleCoverage=60、MarketOverview=6，所有深层表和 KnowledgeChunk=0。
4. 逐国从 DB 回读并与 loader canonical 深度相等。
5. 在一个合成失败国家事务中证明全部回滚。

不得执行 `migrate reset`、`db push`、drop 或 truncate；隔离数据库/容器的创建与销毁由测试外层负责。

**Step 2: 在临时本地 PostgreSQL/pgvector 容器运行**

容器名、数据库名和端口固定为任务专用值；不得连接生产库：

```bash
docker run --detach --rm \
  --name navigator-platform-db-1-test \
  --publish 127.0.0.1:55432:5432 \
  --env POSTGRES_USER=navigator_test \
  --env POSTGRES_PASSWORD=navigator_test_only \
  --env POSTGRES_DB=navigator_platform_db_1_test \
  pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0

for navigator_attempt in $(seq 1 30); do
  if docker exec navigator-platform-db-1-test \
    pg_isready --username navigator_test --dbname navigator_platform_db_1_test
  then
    break
  fi
  if [ "$navigator_attempt" -eq 30 ]; then exit 1; fi
  sleep 1
done

DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma generate --schema prisma/schema.prisma

DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma migrate deploy --schema prisma/schema.prisma

pnpm --filter @navigator/db prisma:validate
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec vitest run \
    src/approved-basic-countries-postgres.integration.test.ts

docker stop navigator-platform-db-1-test
```

Expected: 六国计数、二次幂等、回读等价和回滚测试全部通过。

**Step 3: 提交**

在 CI `verify` job 增加同一 digest 的 pgvector service、health check，以及只对 migration/integration step 生效的 loopback `DATABASE_URL`；普通单元测试仍不依赖数据库：

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0
    env:
      POSTGRES_USER: navigator_test
      POSTGRES_PASSWORD: navigator_test_only
      POSTGRES_DB: navigator_platform_db_1_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U navigator_test -d navigator_platform_db_1_test"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

安装依赖后增加 migration 与 integration 两步，二者的 env 都固定为 CI service URL：

```yaml
- name: Generate Prisma client
  env:
    DATABASE_URL: postgresql://navigator_test:navigator_test_only@127.0.0.1:5432/navigator_platform_db_1_test
  run: pnpm --filter @navigator/db exec prisma generate --schema prisma/schema.prisma

- name: Apply test database migrations
  env:
    DATABASE_URL: postgresql://navigator_test:navigator_test_only@127.0.0.1:5432/navigator_platform_db_1_test
  run: pnpm --filter @navigator/db exec prisma migrate deploy --schema prisma/schema.prisma

- name: PostgreSQL BASIC import integration
  env:
    DATABASE_URL: postgresql://navigator_test:navigator_test_only@127.0.0.1:5432/navigator_platform_db_1_test
  run: >-
    pnpm --filter @navigator/db exec vitest run
    src/approved-basic-countries-postgres.integration.test.ts
```

```bash
git add packages/db/src/approved-basic-countries-postgres.integration.test.ts \
  docs/testing.md .github/workflows/ci.yml
git commit -m "test(db): verify six BASIC imports in PostgreSQL"
```

## 任务 6：任务级复核与交付

**Step 1: 运行完整验证**

```bash
pnpm --filter @navigator/db validate:approved-basic-publications
pnpm --filter @navigator/db prisma:validate
pnpm lint
pnpm typecheck
pnpm test
git diff --check main...HEAD
```

**Step 2: 生成 review package 并派发独立 reviewer**

review 必须核验：无 schema/依赖改动；每国短事务；preflight 与回读在同一事务；批处理串行；六国不硬编码；错误脱敏；无 audit/staging/AI 写入；真实 PostgreSQL 集成结果。

**Step 3: 修复全部 Critical/Important 并重新运行验证**

**Step 4: 按既定路径合并 `main`、验证 merged-main、推送并观察 CI**
