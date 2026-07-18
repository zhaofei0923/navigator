# PLATFORM-API-1 NestJS 国家只读 API 实施计划

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task. Do not execute dependency installation until Gate 0 is explicitly approved.

**Goal:** 建立独立 NestJS `/api/v1` 服务，以 PostgreSQL/Prisma 为默认国家数据源，并让 Next.js 只承担展示、SSR API client 与透明 BFF；三个现有 GET 接口的 HTTP 状态、content-type、解析后的 JSON、双语降级、BUILDING 和错误 envelope 保持语义等价。

**Architecture:** 先把现有 1,097 行 Web service 拆为 storage-neutral contract/query/formatter 与 repository port，再实现 Prisma repository 和显式 canonical rollback repository。Nest controller 只做输入/语言解析、调用 application service 和错误映射；Next BFF 只转发。数据源通过启动时配置显式选择，数据库错误绝不静默回退文件。

**Tech Stack:** TypeScript strict、NestJS 11、Prisma、Next.js App Router、Vitest、Node `fetch`。不修改三个国家业务接口的 contract、Prisma schema、AI/权限边界；健康检查的 `/api/v1` 例外会显式登记到 `docs/api-contract.md`。

**Hard prerequisite:** `PLATFORM-DB-1` 必须已合并到 `main`，merged-main 的六国 PostgreSQL import/readback integration 与 CI 全绿，方可执行本计划任何任务。任务 1 虽是纯抽取，也不提前混入 DB 分支，保持 roadmap 的 DB → API → OPS 严格串行。

---

## Gate 0：新增依赖人工确认

在安装前记录项目所有者对以下精确最小集合的批准：

```text
dependencies:
  @nestjs/common@11.1.28
  @nestjs/core@11.1.28
  @nestjs/platform-express@11.1.28
  reflect-metadata@0.2.2
  rxjs@7.8.2
devDependencies:
  @nestjs/testing@11.1.28
```

不安装 Nest CLI、Swagger、Axios、`@nestjs/config`、class-validator、class-transformer、supertest、Redis 或 APM。查询校验复用/提取现有纯 TypeScript parser；API 环境校验遵循 shared validator 的错误脱敏约定，但使用本服务独立的 scoped parser。

若 Gate 0 未批准，只可完成任务 1–2 的无新依赖工作；不得执行 `pnpm add` 或创建依赖 Nest 的源文件。

## 任务 1：提取共享 API contract、查询 parser 与纯 formatter

**Files:**

- Create: `packages/shared-types/src/country-api.ts`
- Create: `packages/shared-types/src/country-query.ts`
- Create: `packages/shared-types/src/country-formatter.ts`
- Create: `packages/shared-types/src/country-runtime.ts`
- Create: `packages/shared-types/src/country-api.test.ts`
- Create: `packages/shared-types/src/country-query.test.ts`
- Create: `packages/shared-types/src/country-formatter.test.ts`
- Modify: `packages/shared-types/package.json`
- Create: `packages/shared-types/tsconfig.build.json`
- Modify: `packages/shared-types/src/index.ts`
- Modify: `apps/web/src/features/countries/country-service.ts`
- Modify: `apps/web/src/features/countries/filter-params.ts`
- Modify: existing Web country service and route tests only to import the extracted contracts; expected bodies must not change.

**Step 1: 先冻结迁移前 golden**

从现有 Web tests 生成代码内 fixture（不是 snapshot 文件），至少覆盖：六国列表/详情；10 个模块；`zh-CN`/`en`；`localized`/`raw`；缺翻译 fallback；分页、全部筛选与全部非法值；未知国家；BUILDING 200 空数组；敏感字段脱敏。

新增测试：对每个 fixture，当前 Web builder 的 `status` 与 `body` 深度等于 golden。

**Step 2: 运行基线 GREEN**

```bash
pnpm --filter @navigator/web exec vitest run \
  src/features/countries/country-service.test.ts \
  src/app/api/v1/countries/route.test.ts \
  'src/app/api/v1/countries/[code]/route.test.ts' \
  'src/app/api/v1/countries/[code]/modules/[moduleKey]/route.test.ts'
```

**Step 3: 先写 shared package RED tests**

固定接口：

```ts
export interface CountryReadRepository {
  list(): Promise<readonly CountryDataSnapshot[]>;
  findByCode(code: string): Promise<CountryDataSnapshot | null>;
}

export interface CountryDataSnapshot {
  readonly country: JsonObject;
  readonly marketOverview: JsonObject | null;
  readonly policy: readonly JsonObject[];
  readonly risk: readonly JsonObject[];
  readonly opportunities: readonly JsonObject[];
  readonly projects: readonly JsonObject[];
  readonly partners: readonly JsonObject[];
  readonly chineseCompanies: readonly JsonObject[];
  readonly entryStrategy: JsonObject | null;
  readonly reports: readonly JsonObject[];
  readonly knowledge: readonly JsonObject[];
}
```

`JsonValue/JsonObject` 为递归只读 JSON 类型，不允许 `any`。parser 必须保留：`pageSize` 最大值截断为 100；非法正整数/枚举返回现有 `VALIDATION_ERROR` details；code 继续 `trim().toUpperCase()`；locale 优先 query → Accept-Language → `zh-CN`。

新增 `parseCountryCodeParam()` 并以迁移前行为为 golden：小写与两侧空白规范化为大写；空字符串、长度不为 2 或语法上/业务上未知的 code 最终均保持现有 `NOT_FOUND`，不得擅自改成 400。moduleKey 仍走固定枚举校验并产生现有 400 envelope。

formatter 必须保留：published 且非 UNVERIFIED 的 C 端过滤；AI 模块额外 `aiUsable=true`；raw 保留 `{zh,en}` 且无 `_i18nFallback`；localized 记录完整 fallback path；移除 embedding/fileUrl；tag 筛选要求全部命中；现有排序和 signals 不变。

**Step 4: 实现最小抽取并保持 Web wrapper**

`country-service.ts` 暂时保留同名 exports，但只负责把现有 canonical registry 包装成 `CountryReadRepository` 后调用 shared application functions。shared 包不得导入 Prisma、Node fs、Nest、Next 或 country JSON。列表排序固定为国家中立规则：显式的区域展示顺序，再按 `country.code` 作稳定 tie-break；该规则必须生成当前 `ID,VN,SA,AE,BR,ZA` golden，并对未来国家自动生效，repository 不得依赖数据库默认顺序。

为生产 Node runtime 增加真正可加载的编译产物：`tsconfig.build.json` 输出 `dist/*.js` 与声明文件且排除测试，并增加 `build` script。现有供 Next/Vitest 消费的 source subpaths 继续指向 `.ts`，避免破坏 Web dev/test；另新增唯一 server-runtime subpath `@navigator/shared-types/country-runtime`，其 export 使用 `types -> src/country-runtime.ts`、`development -> src/country-runtime.ts`、`default -> dist/country-runtime.js`。DB/API 的生产代码只从该 runtime subpath 导入，且各自 Vitest config 显式启用 `development` condition；普通 Node 不带该 condition，只能解析 `dist`，禁止编译后的 API import `.ts`。

`country-runtime.ts` 只聚合 country contract/query/formatter 所需 exports，其所有相对 import 使用 `.js`，不得把整个 shared index 或不相关模块拖入 server runtime。干净 checkout 测试先构建 shared，再用普通 `node`（无 custom conditions/source hook）import runtime subpath；随后删除临时复制的 source tree仍须可导入，以证明 default 真正指向 dist。

**Step 5: 运行双边 GREEN**

```bash
pnpm --filter @navigator/shared-types test
pnpm --filter @navigator/web test
pnpm --filter @navigator/shared-types typecheck
pnpm --filter @navigator/web typecheck
```

**Step 6: 提交**

```bash
git add packages/shared-types apps/web/src/features/countries \
  apps/web/src/app/api/v1/countries
git commit -m "refactor(api): extract country contract and formatter"
```

## 任务 2：实现 Prisma 与 canonical 两个 repository adapter

**Files:**

- Create: `packages/db/src/read/prisma-country-read-repository.ts`
- Create: `packages/db/src/read/approved-publication-country-read-repository.ts`
- Create: `packages/db/src/read/country-read-runtime.ts`
- Create: `packages/db/src/country-read-repository.contract.test.ts`
- Create: `packages/db/src/prisma-country-read-repository.test.ts`
- Create: `packages/db/src/country-read-runtime.test.ts`
- Create: `packages/db/tsconfig.build.json`
- Create: `packages/db/vitest.config.ts`
- Modify: `packages/db/package.json`
- Modify: `packages/db/src/index.ts`

**Step 1: 写 repository contract RED suite**

同一套 contract suite 运行两个 adapter，要求：

- `list()` 返回自动发现的六国，顺序与迁移前 golden 一致。
- `findByCode()` 只接受规范化 ISO2；未知返回 null。
- country、十项 coverage、market overview 全部字段与 canonical 等价。
- BASIC 深层模块与 KnowledgeChunk 全空；adapter 不返回 staging/approval/audit。
- Prisma 查询只使用 `where/select/include`；公开列表/模块关系固定过滤 `reviewStatus=published AND credibility != UNVERIFIED`，knowledge 额外 `aiUsable=true`。
- 数据库缺 coverage、重复/非法 JSON、关系 countryCode 漂移时 fail closed。
- 两个 adapter 都按任务 1 的国家中立展示规则显式稳定排序，不能依赖 `findMany` 或目录枚举的默认顺序。
- canonical runtime 的 ping 只检查启动时已批准且冻结的 snapshot，断开数据库不影响它；Prisma runtime ping 使用调用方给出的有限 `maxWaitMs/timeoutMs`，但本任务不创建 HTTP health endpoint。

**Step 2: 运行 RED**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/country-read-repository.contract.test.ts \
  src/prisma-country-read-repository.test.ts
```

**Step 3: 实现 adapters**

canonical adapter 必须调用 approved publication loader，不直接 `JSON.parse` 文件，并只接受启动配置注入的绝对 `CANONICAL_REPOSITORY_ROOT`；路径不得来自 request，必须 normalize 后验证其 `data/` 与 publication 结构，且在非仓库 cwd 下仍可运行。Prisma adapter 接受注入的 client，禁止在请求中 `new PrismaClient()`，禁止 raw SQL。它返回 shared `CountryDataSnapshot`，不泄露 Prisma enum、delegate 或 `JsonValue`。

`@navigator/db` 对 API 暴露受控工厂，而不是让 API 直接依赖 `@prisma/client`：

```ts
export interface CountryReadRuntime {
  readonly repository: CountryReadRepository;
  ping(options: { readonly maxWaitMs: number; readonly timeoutMs: number }): Promise<void>;
  close(): Promise<void>;
}

export function createPrismaCountryReadRuntime(options: {
  readonly databaseUrl: string;
}): CountryReadRuntime;

export function createApprovedPublicationCountryReadRuntime(options: {
  readonly repositoryRoot: string;
}): CountryReadRuntime;
```

Prisma 工厂在进程级只创建一个 client，并把 repository、受时限的 readiness ping 与幂等 close 包在有限接口中；连接 URL 在任务 OPS-1 的配置层被强制补入 pool 参数与 `application_name`。canonical 工厂启动时一次性加载/验证/冻结 approved publications，`ping()` 只验证已加载 snapshot 仍满足可信不变量，`close()` 为幂等 no-op，绝不要求故障数据库。任务 2 只验证 runtime port，不宣称 HTTP health 已交付；health endpoint 与 source-aware status 属于 OPS-1。API package 不声明或 import `@prisma/client`。

为 DB 增加排除测试的 `tsconfig.build.json` 与 `build` script；只新增专用 `@navigator/db/country-read-runtime` conditional export（`types/development/default` 指向 `src/read/country-read-runtime.ts` / source / `dist/read/country-read-runtime.js`），不让 API import 会急切加载所有 seed/collection 模块的 root index。DB runtime 内部只依赖 shared 的 `country-runtime` server subpath。`packages/db/vitest.config.ts` 显式启用 `development` condition；DB 的 `prebuild` 先构建 shared-types，API 普通 Node 构建/启动只能加载两个 package 的 `dist` 产物。

**Step 4: 运行 GREEN 并提交**

```bash
pnpm --filter @navigator/db exec vitest run \
  src/country-read-repository.contract.test.ts \
  src/prisma-country-read-repository.test.ts \
  src/country-read-runtime.test.ts
pnpm --filter @navigator/db typecheck
pnpm --filter @navigator/db build
git add packages/db/src/read packages/db/src/*country-read-repository*.test.ts \
  packages/db/src/country-read-runtime.test.ts packages/db/src/index.ts \
  packages/db/package.json packages/db/tsconfig.build.json \
  packages/db/vitest.config.ts
git commit -m "feat(db): add country read repositories"
```

## 任务 3：Gate 0 后创建最小 NestJS app

**Files:**

- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/tsconfig.build.json`
- Create: `apps/api/vitest.config.ts`
- Create: `apps/api/src/main.ts`
- Create: `apps/api/src/app.module.ts`
- Create: `apps/api/src/api-config.ts`
- Create: `apps/api/src/api-config.test.ts`
- Create: `apps/api/src/runtime/country-read-runtime.provider.ts`
- Create: `apps/api/src/runtime/country-read-runtime.provider.test.ts`
- Create: `apps/api/scripts/runtime-smoke.mjs`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 获得并记录 Gate 0 明确批准**

**Step 2: 安装精确依赖**

```bash
pnpm --filter @navigator/api add \
  @nestjs/common@11.1.28 @nestjs/core@11.1.28 \
  @nestjs/platform-express@11.1.28 reflect-metadata@0.2.2 rxjs@7.8.2
pnpm --filter @navigator/api add -D @nestjs/testing@11.1.28
```

`apps/api/package.json` 先通过 `apply_patch` 创建 workspace package，再执行安装；检查 lockfile 只出现上述 direct dependencies 及其传递依赖。

package scripts 必须为：

```json
{
  "prebuild": "pnpm --filter @navigator/shared-types build && pnpm --filter @navigator/db build",
  "build": "tsc --project tsconfig.build.json",
  "lint": "tsc --project tsconfig.json --noEmit --pretty false",
  "typecheck": "tsc --project tsconfig.json --noEmit --pretty false",
  "test": "vitest run",
  "start": "node dist/main.js",
  "smoke:dist": "node scripts/runtime-smoke.mjs"
}
```

内部 workspace dependencies 为 `@navigator/db: workspace:*` 与
`@navigator/shared-types: workspace:*`。`tsconfig.json` 明确开启
`experimentalDecorators` 与 `emitDecoratorMetadata`；`tsconfig.build.json` 关闭
`noEmit`、输出到 `dist`，并排除 `*.test.ts`。`vitest.config.ts` 显式设置 `resolve.conditions=["development"]`，使测试读取 workspace source；所有 ESM 相对 import 使用 `.js` 后缀。API 只从 `@navigator/db/country-read-runtime` 与 `@navigator/shared-types/country-runtime` 导入 server runtime，不 import 两包 root/source-only subpaths。

**Step 3: 写配置 RED test**

固定变量：

```text
API_PORT=3100                   # 1024..65535
COUNTRY_READ_SOURCE=database   # database|canonical
DATABASE_URL=<required for database source>
CANONICAL_REPOSITORY_ROOT=<absolute path; required only for canonical source>
```

非法/缺失只返回变量名，不回显值。生产默认 source 为 `database`；canonical 只能显式选择。API 使用独立的 `validateApiEnv()`，只读取本服务所需的上述四项，不得要求或读取 AUTH/AI/LEAD secrets。`database` 只要求 `DATABASE_URL` 且忽略 canonical root；`canonical` 只要求绝对、已规范化的 `CANONICAL_REPOSITORY_ROOT` 且不要求数据库 URL。同步更新 `.env.example` 与 `docs/env-config.md`；文档将现有“统一通过 Nest ConfigModule”改成“不绑定第三方包的集中 schema validator + 各服务 scoped parser”，因为本任务明确不引入 `@nestjs/config`。

**Step 4: 实现 bootstrap 与优雅关闭**

global runtime provider 根据 validated source 恰好调用一个 DB package 工厂：database → Prisma runtime，canonical → approved-publication runtime；controller 后续只注入其 repository。provider 实现 Nest shutdown hook 并以内部 once guard 保证 close 一次，测试 database/canonical/非法配置与并发注入。

`main.ts` 必须 import `reflect-metadata`，设置全局前缀 `api/v1`，并预留根路径
`GET /health/live`、`GET /health/ready` 的 prefix exclusions；只通过 `@navigator/db` 工厂获得一个进程级 runtime，并在 SIGTERM/SIGINT 仅 close 一次：

```ts
app.setGlobalPrefix("api/v1", {
  exclude: [
    { path: "health/live", method: RequestMethod.GET },
    { path: "health/ready", method: RequestMethod.GET },
  ],
});
```

M1 API listener 固定 `await app.listen(config.port, "127.0.0.1")`，不接受环境变量覆盖 bind host；外部流量只能先到同机 TLS reverse proxy/Next BFF。bootstrap test 检查实际 address 为 loopback，源码守卫拒绝无 host 的 `listen(port)` 或 `0.0.0.0`。未来容器内网/多节点绑定属于部署拓扑变更，需另卡显式批准并配套 network policy。

**Step 5: 运行 GREEN 与提交**

```bash
pnpm --filter @navigator/api test
pnpm --filter @navigator/api typecheck
pnpm --filter @navigator/api build
CANONICAL_REPOSITORY_ROOT="$PWD" pnpm --filter @navigator/api smoke:dist
pnpm install --frozen-lockfile
```

`runtime-smoke.mjs` 必须用 `fs.mkdtemp()` 创建非仓库 cwd，从脚本位置解析绝对 repo root，启动此阶段的 `dist/main.js`（canonical source、固定 loopback 测试端口、显式绝对 canonical root），仅用 Node `net` 证明该端口开始监听，再 SIGTERM 并等待正常退出；此阶段 countries/health controller 尚未创建，禁止探测不存在的路由。它证明 workspace imports 走 shared/db `dist`、canonical root 不依赖 cwd。脚本不得从 request 或当前目录推导数据根。

在 CI 的显式 `prisma generate` 之后、typecheck 后增加 `pnpm --filter @navigator/api build` 与 canonical `smoke:dist`，证明发布入口可由干净 checkout 编译并由普通 Node 加载；不得使用 TypeScript source hook。

```bash
git add apps/api pnpm-lock.yaml .github/workflows/ci.yml \
  docs/env-config.md .env.example
git commit -m "feat(api): add minimal NestJS service"
```

## 任务 4：实现三个 Nest GET 接口与契约等价测试

**Files:**

- Create: `apps/api/src/countries/countries.module.ts`
- Create: `apps/api/src/countries/countries.controller.ts`
- Create: `apps/api/src/countries/countries.service.ts`
- Create: `apps/api/src/countries/country-read-provider.ts`
- Create: `apps/api/src/common/contract-exception.filter.ts`
- Create: `apps/api/src/countries/countries.contract.test.ts`
- Create: `apps/api/src/common/contract-exception.filter.test.ts`
- Modify: `apps/api/scripts/runtime-smoke.mjs`

**Step 1: 写真实 HTTP RED contract tests**

用 `@nestjs/testing` 覆盖 provider，启动随机 loopback port，用 Node `fetch` 对 golden matrix 请求：

```text
GET /api/v1/countries
GET /api/v1/countries/:code
GET /api/v1/countries/:code/modules/:moduleKey
```

逐个断言 Nest HTTP status、JSON content-type、解析后的 body 与迁移前 golden 深度相等（不比较 JSON 属性字节顺序）。golden 明确覆盖空/空白/lowercase/长度异常/未知 country code 与全部非法 module/query。额外断言：非法 query 不调用 repository；DB throw 映射为 `500 INTERNAL_ERROR`；未知国家 404；BUILDING 为 200；响应不含 SQL、连接串、绝对路径、staging、embedding 或 fileUrl。

**Step 2: 实现 controller/service/filter**

controller 只传原始 query/header/param 给共享 parser；service 调用 repository 和共享 formatter。exception filter 只输出现有 envelope：

```json
{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Internal server error"}}
```

具体 message 必须以当前 contract fixture 为准，不自行改措辞。

**Step 3: 运行 GREEN 并提交**

本任务完成后把 `runtime-smoke.mjs` 的 TCP probe 升级为 `GET /api/v1/countries?locale=en`，要求 200、JSON content-type 与合法 success envelope；仍从非仓库 cwd 使用 canonical source。health probe 继续留给 OPS health 任务。

```bash
pnpm --filter @navigator/api exec vitest run src/countries src/common
pnpm --filter @navigator/api typecheck
pnpm --filter @navigator/api build
CANONICAL_REPOSITORY_ROOT="$PWD" pnpm --filter @navigator/api smoke:dist
git add apps/api/src apps/api/scripts/runtime-smoke.mjs
git commit -m "feat(api): serve country reads through NestJS"
```

## 任务 5：把 Next API routes 改为透明 BFF

**Files:**

- Create: `apps/web/src/server/country-api-proxy.ts`
- Create: `apps/web/src/server/country-api-proxy.test.ts`
- Modify: three existing `apps/web/src/app/api/v1/countries/**/route.ts`
- Modify: their route tests
- Create: `apps/web/src/instrumentation.ts`
- Modify: `packages/shared-types/src/env.ts`
- Modify: `packages/shared-types/src/env.test.ts`
- Modify: `docs/env-config.md`
- Modify: `.env.example`

**Step 1: 写 BFF RED tests**

固定 `API_INTERNAL_BASE_URL=http://127.0.0.1:3100/api/v1`。只允许 `http/https`，禁止 credentials、query/hash，生产必须 https 或 loopback。BFF 必须：

- 仅转发 GET、已验证 path/query、Accept-Language、trace/request id。
- 不转发 cookie、Authorization、host、x-forwarded-*。
- 上游请求固定 5 秒超时，使用 `redirect: "manual"`；3xx、非 JSON 或超过 2 MiB 的响应按安全 500 处理。
- 原样保留 Nest status、JSON body、content-type、request id、`X-Navigator-Cache` 与 `X-Navigator-Data-Stale`。
- 连接失败返回现有 500 envelope，不泄露 origin/exception。
- 三个 route 源码不再 import registry/country-service/canonical JSON。

**Step 2: 更新 env 三件套并实现 proxy**

同时更新 `docs/env-config.md`、`.env.example`、shared validator/tests；`apps/web/src/instrumentation.ts` 在 Node server register 时调用 Web scoped validator，使 dev/start/build 的服务端入口在接受请求前 fail-fast。客户端 bundle 不得读取或暴露 `API_INTERNAL_BASE_URL`。

**Step 3: 运行 GREEN 并提交**

```bash
pnpm --filter @navigator/web exec vitest run \
  src/server/country-api-proxy.test.ts src/app/api/v1/countries
pnpm --filter @navigator/shared-types test
git add apps/web/src/server apps/web/src/app/api/v1/countries \
  packages/shared-types/src/env.ts packages/shared-types/src/env.test.ts \
  docs/env-config.md .env.example
git commit -m "refactor(web): proxy country API through NestJS"
```

## 任务 6：迁移 Next SSR/组件，移除文件读取后门

**Files:**

- Create: `apps/web/src/server/country-api-client.ts`
- Create: `apps/web/src/server/country-api-client.test.ts`
- Modify: `apps/web/src/app/[locale]/countries/page.tsx`
- Modify: `apps/web/src/app/[locale]/countries/[code]/page.tsx`
- Modify: `apps/web/src/features/countries/country-explorer.tsx`
- Modify: `apps/web/src/features/countries/country-detail.tsx`
- Modify: associated component/page tests
- Create: `scripts/run-platform-e2e.mjs`
- Create: `scripts/run-platform-e2e.test.mjs`
- Modify: `playwright.config.ts`
- Modify: root `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `docs/testing.md`
- Delete only after all consumers migrate: `apps/web/src/features/countries/country-seed-registry.ts`

**Step 1: 写 RED source-boundary tests**

静态扫描 Web production files：除 test fixture 外不得 import `data/*.json`、approved publication loader、registry 或本地 response builders。组件测试固定为 props-only，不允许组件内部 fallback 到 canonical。

**Step 2: 实现 server-only API client 和 props flow**

SSR page 从 Nest 取列表/详情/模块后传入纯展示组件。server client 的所有 fetch 显式 `cache: "no-store"`，相关 page 导出 `dynamic = "force-dynamic"`，禁止 Next build/prerender 阶段访问 API；进程内 country response cache 只存在 Nest。行业/技术筛选选项使用 shared 固定枚举，不从隐藏 registry 推导。404 使用 Next `notFound()`，500 走现有错误页，不静默读文件。

**Step 3: 运行 Web 单测与中英 E2E**

先把 E2E 启动链改成唯一受控入口 `scripts/run-platform-e2e.mjs`：

1. 若外部传入 `DATABASE_URL`，只接受字面 loopback host 且数据库名精确为 `navigator_platform_db_1_test`；若未传入，先证明固定名 `navigator-platform-e2e-postgres` 不存在，再用 DB-1 相同 pinned pgvector digest、固定 55433 端口创建任务专用 `--rm` 容器，并只在 finally 停止自己创建的容器。
2. 串行执行 `prisma generate`、`migrate deploy` 与 `import:approved-basic-publications`，不得 reset/drop/truncate；确认六国已就绪。
3. 先证明 127.0.0.1:3100/3000 未被占用；构建 API，然后以 `COUNTRY_READ_SOURCE=database` 启动 API，再以 `API_INTERNAL_BASE_URL=http://127.0.0.1:3100/api/v1` 启动 Web；API 阶段只轮询已存在的 `GET /api/v1/countries?locale=en`（200 + 合法 JSON envelope），再轮询 Web `/en`。`/health/ready` 尚属 OPS，不能提前依赖。
4. 设置 `E2E_SERVERS_MANAGED=1` 后运行 Playwright；finally 只终止自己 spawn 的两个进程组并等待退出。任何 3xx readiness、进程提前退出或 cleanup 失败都令命令失败。

`playwright.config.ts` 移除单独启动 Web 的旧 `webServer`；在未设置 `E2E_SERVERS_MANAGED=1` 时 fail fast，提示使用 `pnpm test:e2e`。root `test:e2e` 改为执行该 orchestrator。CI E2E step 显式传入 service 的 loopback `DATABASE_URL`，因此不创建 Docker 容器；这条链证明 migration/import → API → Web → browser 的完整顺序。

`node --test scripts/run-platform-e2e.test.mjs` 以注入的 fake spawn/fetch/port probe 覆盖非法 URL 零副作用、已有容器/占用端口拒绝、countries probe 非 200/非 JSON 时不启动 Web、任一子进程提前退出与 finally 仅清理 owned resources。

```bash
pnpm --filter @navigator/web test
pnpm --filter @navigator/web typecheck
API_INTERNAL_BASE_URL=http://127.0.0.1:9/api/v1 \
  pnpm --filter @navigator/web build
node --test scripts/run-platform-e2e.test.mjs
pnpm test:e2e
```

上述 production build 故意指向未监听的 loopback port 9；它必须成功且日志中无 fetch，证明 dynamic/no-store 页面不产生 build-time 网络依赖。CI 同样执行这条 Web build 后再进入受控 E2E。

**Step 4: 提交**

```bash
git add apps/web scripts/run-platform-e2e.mjs scripts/run-platform-e2e.test.mjs \
  playwright.config.ts \
  package.json .github/workflows/ci.yml docs/testing.md
git commit -m "refactor(web): read country pages from NestJS"
```

## 任务 7：数据库/回退 provider 双实现验收

**Files:**

- Modify: `apps/api/src/countries/country-read-provider.ts`
- Create: `apps/api/src/countries/country-read-provider.test.ts`
- Modify: `docs/testing.md`

**Step 1: 写 provider RED tests**

- `database` 构造 Prisma repository。
- `canonical` 只使用启动配置中的绝对 repository root 构造 approved publication repository，并在非仓库 cwd 测试。
- 非法 source 启动失败。
- 两个 provider 对六国 golden 的 HTTP status、content-type、解析 JSON 与错误 envelope 完全相同。
- database provider 抛错时返回 500，不切到 canonical。

**Step 2: 实现、运行并提交**

```bash
pnpm --filter @navigator/api test
git add apps/api/src/countries docs/testing.md
git commit -m "test(api): verify database and rollback providers"
```

## 任务 8：任务级复核与交付

```bash
pnpm --filter @navigator/db prisma:validate
pnpm --filter @navigator/api build
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e
git diff --check main...HEAD
```

独立 reviewer 必须核验：三个接口 golden 等价；Next 无 canonical 后门；默认数据库、显式回退、无静默 fallback；所有输入服务端校验；Prisma 参数化；敏感错误脱敏；仅安装 Gate 0 批准依赖。修复所有 Critical/Important 后按既定路径合并 `main`、验证 merged-main、推送并观察 CI。
