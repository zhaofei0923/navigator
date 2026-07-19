# PLATFORM-OPS-1：M1 故障演练记录

- 演练日期：2026-07-19
- 演练代码：`65b58f0478c9690c0f85fd5cc4779b61d5154e7f`
- 结论：M1 计划内的缓存、数据库新建连接失败、连接池等待超时、恢复与停机路径均通过
- 适用范围：单个 NestJS API 进程、6 个已发布 BASIC 国家、只读流量、AI 占比 0、写入占比 0

## 1. 环境、构建与证据绑定

演练使用独立 PostgreSQL 容器和真实 production build，不复用开发数据库：

| 项目 | 演练值 |
|---|---|
| PostgreSQL 镜像 | `pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0` |
| Node / Prisma / PostgreSQL | `v24.18.0` / `6.19.3` / `17.10` |
| 数据计数 | `6 / 60 / 6 / 0`（国家 / 模块覆盖 / 市场概览 / knowledge chunks） |
| API / metrics | `127.0.0.1:3100` / `127.0.0.1:9464` |
| Prisma pool | 最大 10，pool timeout 1 秒，connect timeout 1 秒 |
| 只读缓存 | TTL 2 秒，stale-if-error 30 秒，最多 1,000 entries |
| readiness timeout | 500 ms |

短 TTL 和短 timeout 只用于在隔离环境确定性验证状态转换，不替代容量基线中的生产建议值。数据库初始化通过真实迁移和 4 项 PostgreSQL 集成测试，外层查询再次得到 `6 / 60 / 6 / 0`。

`environment.json` 仅包含 allowlist 字段：Git SHA、52 个 `apps/api/dist` 文件的清单哈希、版本、镜像身份、非敏感数据库目标、数据计数、集成测试摘要和非敏感运行配置。一次性 wrapper 在调用 `bootstrap()` 前校验 runtime allowlist、非敏感数据库目标和 dist 清单身份，并在启动日志中记录：

```text
git SHA                   65b58f0478c9690c0f85fd5cc4779b61d5154e7f
environment SHA-256       9c73ea5d64c8ced86290da2934e0a84f9a4234f3a664948f1f701a72744aade1
API dist manifest SHA-256 51b25032481dadddbdf0914b13cc4f4530bfcf6f3b22467437f0d8d98bc3eb72
```

演练启动前校验 52 个 dist 文件；结束后重新生成 `api-dist-after.sha256` 并逐字比较。前后两份清单各自的 SHA-256 均为 `51b25032481dadddbdf0914b13cc4f4530bfcf6f3b22467437f0d8d98bc3eb72`，证明本轮执行期间 production build 未变化。证据不记录 DATABASE_URL、用户名、密码或完整环境变量。

`country invalidation` 由 ignored、一次性、信号驱动的 DI harness 调用真实 `ReadonlyResponseCache.invalidateCountry("ID")`。它没有新增受支持或提交到生产代码的 HTTP、后台或 CLI 入口，也没有改变生产权限边界。

## 2. 缓存 TTL 与国家失效

| 场景 | 结果 | DB / 隔离判定 |
|---|---|---|
| `AE/en` 首次、立即重复、TTL 后再次读取 | `miss → hit → miss`；32.556 / 3.458 / 19.768 ms | detail cache miss `+2`、hit `+1`，DB operation `+2` |
| TTL 等待 | 宿主墙钟实际前进 3,002 ms，要求至少 3,000 ms | 最终 header 仍须为 `miss`，不以 sleep 单独判定 |
| 失效前列表、`ID/en`、`VN/en` | 三个 key 均先达到 `miss → hit` | 控制日志确认固定失效国家为 `ID` |
| 失效后的列表、`ID/en`、`VN/en` | `miss / miss / hit`；17.902 / 15.828 / 1.804 ms | 列表和 ID 被清除，其他国家详情未被误删 |

失效前的 list、ID、VN miss/hit 分别为 26.830/3.329 ms、17.576/3.047 ms、17.438/2.527 ms；失效前后对应 body 完全一致。这证明单进程失效原语正确，不代表运营人员已经具备生产触发能力，也不证明多实例即时传播。

## 3. PostgreSQL 暂停、降级与恢复

演练先清空缓存，以 `ID/en` 建立待过期 entry，宿主墙钟实际等待 3,024 ms（要求至少 3,000 ms），再以 `ID/zh-CN` 建立 fresh entry。随后证据确认 `application_name='navigator-api'` 只有 1 条 idle backend，精确终止结果为 `t`，连接水位由 1 降为 0；没有 active API query 被终止。固定测试容器随后执行真实 `docker pause`，状态为 `Running=true`、`Paused=true`。

| 数据库暂停期间的请求 | HTTP / cache | 总耗时 | 判定 |
|---|---|---:|---|
| fresh `ID/zh-CN` | `200 / hit`，无 stale header | 2.434 ms | 不访问数据库，body 与故障前 prime 完全一致 |
| stale `ID/en` | `200 / stale`，`X-Navigator-Data-Stale: 1` | 5.993 ms | body 与故障前 prime 完全一致 |
| no-cache `VN/en` | `500`，无 cache / stale header | 1.011826 s | 固定 `INTERNAL_ERROR` envelope，日志分类为 database unavailable，未回退 canonical |
| `/health/ready` | `503 {"status":"not_ready"}` | 526.785 ms | `Cache-Control: no-store`，低于演练 2 秒硬上界 |
| `/health/live` | `200 {"status":"ok"}` | 2.500 ms | `Cache-Control: no-store` |

解除同一个容器的 pause 后，harness 先等待 `pg_isready`，再轮询 API readiness，最终正式 readiness capture 在 8.737 ms 返回 200 且保持 `Cache-Control: no-store`。`VN/en` 为 28.049 ms miss → 2.940 ms hit，`ID/en` 为 16.928 ms miss → 1.935 ms hit。故障响应没有污染缓存，恢复后可以重新填充。

本演练验证的是“已有空闲连接被终止后，数据库仍处于 pause，新连接受 `connect_timeout` 约束”的真实故障路径。它没有验证已建立连接上的执行中查询被 pause、TCP blackhole 或数据库长期不返回结果；`connect_timeout` 和 `pool_timeout` 也不等于 statement timeout。上线真实生产流量前，应另行评审服务端 `statement_timeout` 或可取消查询时限，并对已建立连接冻结路径专项演练。

## 4. 连接池等待超时

固定测试 backend 先取得 `countries` 表的 `ACCESS EXCLUSIVE` 锁，10 个不同列表 cache key 随后同时进入真实 Prisma 查询：

- PostgreSQL `pg_stat_activity`：`navigator-api` total 10、`wait_event_type='Lock'` 10；
- API metrics：`navigator_db_operations_in_flight{operation="country_list"} = 10`；
- 第 11 个新 key 在 1.015078 秒返回受控 500，无 cache / stale header，日志分类为 `http_request_internal_database_unavailable`；
- overflow 返回后，原 10 个 backend 仍全部等待 relation lock，API in-flight 仍为 10，证明 500 来自 pool slot 等待超时而非提前释放表锁；
- 精确终止唯一 `application_name='navigator-task9-lock'` backend，结果为 `t`；前 10 个请求随后全部返回 `200 / miss`，耗时范围 1.699772–1.710456 秒，平均 1.703665 秒；
- country-list cache miss 和 DB operation 均增加 11，最终 in-flight 回到 0，锁 backend 计数回到 0，10 个 API backend 均恢复 idle。

这项结果只证明 pool=10、pool timeout=1 秒的演练配置；生产实例数和总连接预算仍以容量基线报告为准。

## 5. 优雅停机与清理

一次性 harness 启动日志记录精确 PID `2834649`；只向该 PID 发送 `SIGTERM`：

- 关闭前 PostgreSQL 有 10 条正常 idle `navigator-api` 连接；
- 进程 wait status 为预期的 143；
- API 3100 和 metrics 9464 两个 loopback 端口均关闭；
- PostgreSQL 中 `application_name='navigator-api'` 的连接为 0；
- 固定测试容器随后被停止并因 `--rm` 自动删除，DB 55434 端口也已关闭。

本项验证进程接收 SIGTERM 后释放本地监听和 Prisma 连接；生产发布仍必须先 not-ready、等待负载均衡摘流，再 drain 已接收请求，不能把直接发信号等同于完整编排流程。

## 6. 历史证据与判定纪律

当前通过判定只使用 `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-65b58f0-m1/`。以下目录均只保留为历史，不参与当前 metrics、API log、哈希或通过判定：

- `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-m1/`：绑定旧代码 `0efc82c891dc3a0b63d90fdb9340c0d56c687f15` 的早期成功演练；其 141 项 manifest 自身 SHA-256 为 `30dfb1bb335c708cb7ae4d641e0ca3de77f493d60e52e62bb6c065e3bcaaa6f5`。
- `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-m1-attempts/`：旧 harness 的失败尝试；其重建清单 SHA-256 为 `b02c484f7f208ecd1f9791dc7c64a9fcb96deaedf8233047566d9de0d953adc8`。

旧失败尝试包括墙钟回拨导致 stale entry 尚未过期，以及外部调度间隔使客户端先超时并产生 499。当前 harness 因此同时记录实际墙钟等待、以最终 cache header 判定状态，将 pool 客户端上限提高到 60 秒，并在失败路径精确清理 curl 子进程、解除 pause、终止测试锁、关闭 API 和移除固定容器。历史证据没有被删除、改写或混入当前数字。

## 7. 最终证据完整性与安全

当前原始证据位于 `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-65b58f0-m1/`，被 `.gitignore` 排除，不提交到 Git。`manifest.sha256` 覆盖除自身外全部 150 个文件；清单自身 SHA-256 为 `1f70d85c2250c2dc180a2c7f48330c931c441bca94e8a83ddd693ae7daf668f6`。

| 关键证据 | SHA-256 |
|---|---|
| `setup-counts.txt` | `079de5b5a612f388d087eb9e775520ded49a34fada96962a1f67697621412d69` |
| `setup-integration.log` | `081165b68c540292431d670c884d03162c7aa7b59487acc5f53fe88c3b0984a9` |
| `environment.json` | `9c73ea5d64c8ced86290da2934e0a84f9a4234f3a664948f1f701a72744aade1` |
| `api-dist-manifest.sha256` | `51b25032481dadddbdf0914b13cc4f4530bfcf6f3b22467437f0d8d98bc3eb72` |
| `api-dist-after.sha256` | `51b25032481dadddbdf0914b13cc4f4530bfcf6f3b22467437f0d8d98bc3eb72` |
| `phase-summary.json` | `fd4ebd3322d45ec551466810d2cc618d99a35a95d8f11b49f846a83e7141a2bb` |
| `api.log` | `346b4617f39343f0d81751340e15eeb5042f9abd7ccc9f84068b019c3007ff46` |
| `outage-paused-state.json` | `b2bd1cdb3839b4d7e97c9291d75b82d80c6637cb9cb7d2fdc830973918897b47` |
| `outage-terminated-api-connections.csv` | `f7916d42a4d16df0996d325338b52f4c555829aebb6a93ed3487dfa7513e4c67` |
| `pool-saturated-pg-activity.csv` | `4de2a7e105afa02deffd9e6f7ae737ea3a39c2a1f3d5808ec6362ba0b3bf6954` |
| `pool-lock-terminated.csv` | `985b47d2b5a2f0d8e417fbb0a48a00460967c4b2078e64157354a8b482569baf` |
| `graceful-result.json` | `e9facb43de7a40778bd13587429e6213a0c4e2208a2f1b2aedd6715ae3914a0e` |
| `task9-wrapper.mjs` | `cb9d8e6ddcd7a4797ad7610c292061e26cd21471255052760c919c9065865888` |

独立完整性预检确认：最终 manifest 的 150 项全部通过；`api.log` 的 43 行均为可解析 JSON。最终目录共有 42 个 JSON / meta 文件；`phase-summary.json` 内记录的 41 是生成 summary 自身之前的阶段文件计数，加入 summary 后最终总数为 42。最终 artifact 未发现 DATABASE_URL、测试密码、PostgreSQL URL、Authorization、Bearer 或 API key；文件权限统一为 600，目录权限为 700。

## 8. 未宣称完成的生产能力

- 当前没有经过鉴权、审计、幂等和多实例传播设计的生产 cache invalidation 入口。它应随获批的后台发布流程建设，不能临时暴露无鉴权 endpoint。
- 已建立连接上的执行中查询冻结尚未受 statement timeout 演练保护。
- 多实例本地缓存一致性、数据库自动故障转移、LB 摘流和跨故障域恢复仍应按容量基线的进入条件与季度演练执行。
- AI 占比为 0；AI、会员、计费、导出、报告、后台写入和 ID STANDARD 正式数据均不在本轮运行时范围内。

在上述边界内，当前代码 `65b58f0478c9690c0f85fd5cc4779b61d5154e7f` 的 M1 Task 9 故障演练判定为通过；任何扩大范围的生产能力仍需对应授权、实现和独立验证。
