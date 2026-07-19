# testing.md — 测试规范

> 落实 AGENTS.md 第 8 节：**每个功能/接口必须附带测试，无测试的 PR 不予合并。**
> 提交前必须本地通过：`pnpm lint`、`pnpm typecheck`、`pnpm test`。

---

## 0. 总则

1. 工具链：**Vitest**（单元/集成）+ **Playwright**（E2E），沿用 AGENTS.md 技术栈，不得替换。
2. 无测试的 PR 不合并；修 bug 须先写复现测试再修。
3. 测试与被测代码同层就近放置或置于 `__tests__/`，命名 `*.test.ts` / `*.spec.ts`（E2E 用 `*.e2e.ts`）。
4. 测试必须可独立运行、可重复、无外部真实依赖（用测试库/mock，见 §5）。

---

## 1. 必须有单元测试的对象（AGENTS.md §8）

- **数据模型 / 校验逻辑**：字段校验、枚举约束、`LocalizedText` 结构校验。
- **数据治理校验**：元字段齐全、来源/可信度合法、`draft` / `pending` / `UNVERIFIED` 不进入 C 端展示或覆盖判定。
- **覆盖等级判定**：模块级与国家级判定阈值（[coverage-levels.md §3](./coverage-levels.md)）。
- **i18n 降级**：`pickLocale` 三种缺失分支（[i18n.md §5](./i18n.md)）。
- **RAG 检索边界**：`aiUsable` 过滤硬约束（[data-schema.md §3.1](./data-schema.md)、AGENTS.md §9）。
- **权限门控**：会员等级对受控资源的放行/拒绝（[auth-membership.md](./auth-membership.md)）。

---

## 2. 必须有 E2E 覆盖的关键流程（AGENTS.md §8）

| 流程 | 断言要点 |
|------|----------|
| 首页四板块导航 | 首页 / 国家 / AI 咨询 / 报告可访问，语言切换后导航与核心文案同步变化 |
| 国家列表 / 地图 | 地区、行业、技术、覆盖等级筛选生效；国家卡片显示覆盖等级、更新时间与重点信号 |
| 国家详情页渲染 | 十模块骨架、`BUILDING` 模块显示占位不报错 |
| AI 问答 | 有数据答案含来源/更新时间/风险提示；无数据答「暂无数据」 |
| 报告入口 | 报告列表/申请入口可用；受控下载不暴露真实地址 |
| 留资 | 提交成功、敏感字段不回显 |
| 语言切换 | UI 文案与业务数据同步切换 |

---

## 3. 双语测试（AGENTS.md §7、§8）—— 硬性

- **语言包 key 对齐**：断言各端 `zh-CN.json` 与 `en.json` 的 key 集完全一致（缺一即失败）。
- **双语字段降级回退**：`LocalizedText` 缺 zh / 缺 en / 全缺时的回退与 `fallback` 标记；接口 `_i18nFallback` 正确记录。
- **语言切换同步**：切换后 UI 文案与业务数据文本同时变化。
- **AI 语言一致性**：中文问中文答、英文问英文答；引用双语数据取对应语言，缺失降级。

---

## 4. AI 顾问专项测试（AGENTS.md §9 红线）

- 检索**仅命中** `reviewStatus=published` 且 `aiUsable=true` 且 `credibility!=UNVERIFIED` 的数据；注入 `draft`/`pending`/`UNVERIFIED` 数据后断言**不被检索**。
- 回答**必含** `sources` / `updatedAt` / `riskNote`，缺任一视为失败。
- 检索为空时断言回答为 `ai.noData`（「暂无数据」），**不得编造**。
- prompt 注入用例：来源内容含指令文本时，断言被转义隔离、不改变系统行为。

---

## 4.1 派生评分测试

- 数据不足时返回 Data Building / insufficient data，不输出虚假评级。
- 高风险证据优先，不因机会高而掩盖风险提示。
- 评分结果可追溯来源与更新时间。
- 不同国家使用同一套规则，不为单国写特例。
- 双语展示与降级标记符合 [i18n.md](./i18n.md)。

---

## 5. Mock 与测试数据

- 数据库：用独立测试库（`.env.test` 的 `DATABASE_URL`）或事务回滚/内存替身，禁止连生产库。
- LLM / embedding：mock `AI_PROVIDER` 调用，断言**过滤发生在检索层**而非依赖模型。
- `data/indonesia/` 是已批准的真实 `BASIC` canonical publication；测试必须锁定其 candidate/receipt/manifest 字节身份、canonical 三文件 allowlist、九个 `BUILDING` 占位和 AI/深层模块隔离，同时避免为单国写生产特例。
- Web 构建与 CI 必须调用 `pnpm --filter @navigator/db validate:approved-basic-publications`，按 `data/<countryDirectory>/` 自动发现并验证全部 canonical publication，禁止只校验单一国家或绕过批准回执。
- Deterministic Basic candidate 的 `ID` fixture 只能验证 ISO2/coverage shape；名称、URL、来源内容、值和时间必须明确标为 synthetic fixture-only，不能复制或声称任何真实印度尼西亚事实。

---

## 6. 命令与 CI 门槛

| 命令 | 作用 |
|------|------|
| `pnpm lint` | 代码规范（含无硬编码文案检查，若配置） |
| `pnpm typecheck` | TS strict 类型检查，禁止 `any` |
| `pnpm test` | Vitest 单元/集成 |
| `pnpm test:e2e` | 受控启动 migration/import → Nest API → Next Web → Playwright |

- 三项（lint / typecheck / test）**本地必须通过**方可提交；E2E 至少在 CI 关键流程通过。
- 覆盖率不设唯一硬指标，但 §1–§4 列出的对象/流程**必须有对应用例**，缺失视为不达标。

### 6.1 Deterministic Basic candidate

candidate writer 测试必须先在 Linux filesystem clean-build native helper，再运行 core/composition/index integration：

```bash
rm -f packages/db/.cache/native/basic-candidate-fs.node
pnpm --filter @navigator/db run build:basic-candidate-native
pnpm --filter @navigator/db exec vitest run src/basic-deterministic-candidate-integration.test.ts src/basic-candidate-composition-integration.test.ts src/index.test.ts
```

composition integration 在 Linux `/tmp` 建立真实临时 workspace，使用 fake transport 填充真实 `raw-v2` cache；第二阶段 transport 必须在任何网络调用时抛错。测试必须使用生产 catalog/review/document/editorial/composition/native writer 模块，验证 object-key permutation 的 byte identity、unsorted array 拒绝、blocked 不写 final staging、ready 只写四文件，以及无 manifest/canonical/Prisma/KnowledgeChunk/AI side effect。每次测试都必须关闭 workspace handles 并删除临时目录。

native helper 需要 `/proc/self/fd` 与 `renameat2(RENAME_NOREPLACE)`。不得在 DrvFS（如 `/mnt/c`）执行 writer 验证；不支持该 syscall/flag 时必须 fail closed，禁止 JavaScript rename/copy fallback。本卡没有 Web 行为，定向验收不要求 E2E；完整 branch gate 仍为 `pnpm lint`、`pnpm typecheck`、`pnpm test` 和 `pnpm turbo run lint typecheck test --force`。

### 6.2 六国 BASIC PostgreSQL 集成验收

集成测试只连接任务专用的 disposable pgvector 容器。测试进程必须显式提供 `DATABASE_URL`，且 URL 只允许 `postgresql` 协议、字面量 `127.0.0.1` / `[::1]` host，并要求 authority 后的原始 path 字节精确为 `/navigator_platform_db_1_test`；`localhost`、DNS、其他 IP/库名、dot-segment、percent-encoded path、query/hash 一律在构造 Prisma client 前脱敏拒绝。普通 `pnpm test` 不提供该变量，固定显示 skip 原因且不连接数据库。Prisma client 生成与 migration 由测试外层 harness 负责，集成测试本身不迁移或清库。

使用以下完整 harness。它先证明固定容器名不存在、确认端口空闲，再创建容器并保存本次 `docker run` 返回的 container ID；任一步失败都会退出，trap 只按已保存的本次 ID 清理。若发现已有容器或 `docker run` 因竞态失败，ID 保持为空，禁止复用、停止或清理未知容器：

```bash
set -euo pipefail

navigator_db_test_name="navigator-platform-db-1-test"
navigator_db_test_port="55432"
navigator_db_test_container_id=""

navigator_cleanup_db_test() {
  if [[ -n "$navigator_db_test_container_id" ]]; then
    docker stop "$navigator_db_test_container_id" >/dev/null
    navigator_db_test_container_id=""
  fi
}
trap navigator_cleanup_db_test EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

navigator_existing_db_id="$(
  docker ps -a \
    --filter "name=^/${navigator_db_test_name}$" \
    --format '{{.ID}}'
)"
if [[ -n "$navigator_existing_db_id" ]]; then
  echo "PLATFORM_DB_TEST_CONTAINER_ALREADY_EXISTS" >&2
  exit 1
fi
if ! command -v ss >/dev/null 2>&1; then
  echo "PLATFORM_DB_TEST_PORT_CHECK_UNAVAILABLE" >&2
  exit 1
fi
navigator_db_test_listeners=""
if ! navigator_db_test_listeners="$(
  ss -H -ltn "sport = :${navigator_db_test_port}"
)"; then
  echo "PLATFORM_DB_TEST_PORT_CHECK_FAILED" >&2
  exit 1
fi
if [[ -n "$navigator_db_test_listeners" ]]; then
  echo "PLATFORM_DB_TEST_PORT_IN_USE" >&2
  exit 1
fi

navigator_created_db_id=""
if ! navigator_created_db_id="$(docker run --detach --rm \
  --name "$navigator_db_test_name" \
  --publish "127.0.0.1:${navigator_db_test_port}:5432" \
  --env POSTGRES_USER=navigator_test \
  --env POSTGRES_PASSWORD=navigator_test_only \
  --env POSTGRES_DB=navigator_platform_db_1_test \
  pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0)"
then
  navigator_created_db_id=""
  echo "PLATFORM_DB_TEST_CONTAINER_CREATE_FAILED" >&2
  exit 1
fi
navigator_db_test_container_id="$navigator_created_db_id"

navigator_db_test_ready="false"
for navigator_db_test_attempt in $(seq 1 30); do
  if docker exec "$navigator_db_test_container_id" \
    pg_isready --username navigator_test --dbname navigator_platform_db_1_test
  then
    navigator_db_test_ready="true"
    break
  fi
  sleep 1
done
if [[ "$navigator_db_test_ready" != "true" ]]; then
  echo "PLATFORM_DB_TEST_NOT_READY" >&2
  exit 1
fi

DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma generate --schema prisma/schema.prisma
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec prisma migrate deploy --schema prisma/schema.prisma
pnpm --filter @navigator/db prisma:validate
DATABASE_URL=postgresql://navigator_test:navigator_test_only@127.0.0.1:55432/navigator_platform_db_1_test \
  pnpm --filter @navigator/db exec vitest run \
  src/approved-basic-countries-postgres.integration.test.ts

navigator_cleanup_db_test
trap - EXIT INT TERM
```

验收证明 `0001_init` 已成功应用、真实事务故障全部回滚、六国串行导入两次仍为 Country=6 / ModuleCoverage=60 / MarketOverview=6、其余深层表/KnowledgeChunk/Lead=0，并逐国将数据库回读结果与 canonical publication 做深度相等比较。清理只能使用本流程保存的 container ID，禁止按名称停止容器；禁止连接生产库，禁止 `migrate reset`、`db push`、drop、truncate、`deleteMany` 或由测试执行任何破坏性清理。

### 6.3 平台全链路 E2E

`pnpm test:e2e` 是唯一受支持的浏览器测试入口。它通过
`scripts/run-platform-e2e.mjs` 串行执行 Prisma generate、migration deploy、六国已批准
BASIC 导入、API/Web production build、database source API、Web 与 Playwright。禁止直接执行
`playwright test`；未设置内部标志 `E2E_SERVERS_MANAGED=1` 时 Playwright 配置会 fail fast 并提示
使用根命令。

外部 `DATABASE_URL` 只接受 `postgresql` 协议、字面量 `127.0.0.1` / `[::1]`，且原始路径必须
精确为 `/navigator_platform_db_1_test`，不得带 query/hash。CI 显式传入 service 的 loopback URL，
因此不会启动 Docker。未提供 URL 的本地运行只会在固定名
`navigator-platform-e2e-postgres` 不存在且 `127.0.0.1:55433` 空闲时，创建 DB-1 同一 pinned
pgvector digest 的 `--rm` 容器；finally 只按本次 `docker run` 返回的 container ID 停止它。

启动器在任何 migration/import/build 前证明 `127.0.0.1:3100` 与 `127.0.0.1:3000` 空闲。
API readiness 只轮询根路径 `GET /health/ready`。只有 HTTP 200、JSON content type 与精确
`{"status":"ready"}` 同时满足时才启动 Web；精确的 HTTP 503 `{"status":"not_ready"}` 可在固定
次数内重试，其他状态、非 JSON 或畸形 body 均 fail closed。客户端单次探针 watchdog 为 3 秒，长于
服务端默认最多 1 秒连接池等待加 1 秒事务执行上限。API 就绪后再轮询 Web `/en`，六国数据库/API/Web 结果继续由完整
Playwright 链验证。3xx、非法响应、API/Web 子进程提前退出或 owned resource cleanup 失败都会使
命令失败。流程不执行 reset、drop 或 truncate。

### 6.4 国家只读双 provider 验收

国家只读 API 的 provider 验收必须穿过生产 `AppModule.register()` 组合，只允许在单元测试中注入
runtime factory，不得覆盖 repository token。默认 `database` source 只能构造一次 Prisma runtime；
`canonical` 只能显式选择，并且只使用启动配置中已规范化的绝对 repository root。canonical 验收需从
非仓库 cwd 启动，证明其不依赖进程当前目录。

两个 source 都必须通过同一套完整六国 HTTP golden，精确匹配 status、content-type 与解析后的 JSON。
数据库 repository 抛错时必须返回固定、脱敏的 `500 INTERNAL_ERROR`，不得在请求期间调用 canonical
factory 或静默回退；应用关闭仍须保持 runtime 只关闭一次。该单元验收使用注入的 runtime，不连接真实
PostgreSQL；Prisma adapter 由 DB 集成测试负责，migration/import → database API → Web → browser 由
§6.3 的平台 E2E 负责。

### 6.5 请求关联与日志边界验收

`request-context.test.ts` 验证严格 W3C v00、request-id 边界、非零随机标识、await/timer 上下文保持、并发隔离与请求外清理；`json-logger.test.ts` 验证单次 newline-delimited JSON write、字段白名单、固定错误分类与 sink 失败隔离；`observability.interceptor.test.ts` 验证 middleware 与 interceptor 共用同一请求状态、模板路由、缓存状态、500 脱敏及 `finish`/`close` 只记一次。

`main.test.ts` 必须穿过真实 loopback Nest HTTP，证明已匹配健康路由和未知 404 均携带安全 `x-request-id` / `traceparent` 且各自产生一行日志，并证明 Nest 依赖初始化失败只 reject、不会在固定 bootstrap JSON 事件前直接终止进程。未知 path/query、国家/模块参数、任意非 correlation header、连接串、SQL、联系信息和异常文本不得进入日志；全局 middleware 覆盖 interceptor 无法进入的未知路由。提前 `close` 且 `writableFinished=false` 必须固定记录 499 aborted，异步 sink rejection 必须被隔离。

### 6.6 Event-loop 窗口与容量取证

`metrics-capacity.test.ts` 必须使用可控单调时钟、event-loop delay monitor 与固定 1 秒后台采样器，验证每个已完成窗口读取 percentile 99、仅在有观测且 percentile/reset 都成功时 `valid=true`、sequence 每个已完成窗口恰好递增 1，并使用实际单调时长。首次完成前固定为 `sequence=0`、`valid=false`；无观测、时钟、percentile 或 reset 失败的窗口必须 fail closed，不得用零值伪装健康样本。

`metrics-registry.test.ts` 必须锁定四个无 label gauge 的精确名称：`navigator_event_loop_lag_window_p99_seconds`、`navigator_event_loop_lag_window_sequence`、`navigator_event_loop_lag_window_valid`、`navigator_event_loop_lag_window_duration_seconds`。连续多次 `render()` 必须是纯读：返回相同快照，不调用 percentile/reset，不使 sequence 递增；畸形或抛错的窗口读取统一降级为 `valid=0` 的脱敏快照。

Task 8 runner 必须先读一个有效 anchor，再等到精确的 `anchor.sequence + 1` 有效新窗口后才启动负载，并在 schema v2 结果保存两者 sequence 和两段同步等待时间。固定相位测试必须覆盖 metrics 响应跨 sampler tick，以及 120 秒 warmup 后连续 600 秒 measurement。每个 measurement 期必须保存连续 600 个有效已完成序列：每项 `valid=1` 且相邻 sequence 严格 `+1`；重复 scrape 的同一 sequence 只重试、不重复计数，目标窗口无效、回退、跳号或 500ms 内仍无新 sequence 都使场景失败。event-loop 场景结果只能以这 600 个单秒窗口 p99 计算汇总 p99，门槛为严格 `< 50ms`，等于 50ms 不通过；判定使用未舍入值，展示精度不得改变结论。旧 Task 8 使用累计 mean 的三档证据不可重算真实 p99，必须作为 superseded 历史保留；修复后需以新 run identity 重跑三档、生成新 immutable manifest 并绑定实际 Git SHA，不得覆盖旧 artifact。

---

## 7. 一致性检查清单

- [ ] 新功能/接口附带测试
- [ ] 数据校验、覆盖等级、i18n 降级、RAG 边界、权限门控均有单测
- [ ] 关键流程有 E2E
- [ ] 双语：key 对齐 / 降级 / 切换 / AI 语言一致性均覆盖
- [ ] AI 红线：过滤、来源三要素、空数据、注入防护均覆盖
- [ ] 不连真实生产库/真实 LLM，使用测试库与 mock
- [ ] 本地 `pnpm lint && pnpm typecheck && pnpm test` 通过

---

## 8. Deferred 流程

| 流程 | 恢复条件 | 恢复后测试要求 |
|------|----------|----------------|
| 国家对比 | `roadmap.md` 重新激活任务卡，`api-contract.md` 取消 Deferred 标记 | 2–4 国对比矩阵、缺失模块占位、`codes` 边界校验、E2E |
