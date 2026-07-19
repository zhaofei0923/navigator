# PLATFORM-OPS-1：M1 故障演练记录

- 演练日期：2026-07-19
- 演练代码：`0efc82c891dc3a0b63d90fdb9340c0d56c687f15`
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

`environment.json` 仅包含 allowlist 字段：Git SHA、52 个 `apps/api/dist` 文件的清单哈希、版本、镜像身份、非敏感数据库目标、数据计数、集成测试摘要和非敏感运行配置。一次性 wrapper 在调用 `bootstrap()` 前验证实际进程配置与该 allowlist 完全一致，验证 dist 清单哈希，并在启动日志中记录：

```text
git SHA                 0efc82c891dc3a0b63d90fdb9340c0d56c687f15
environment SHA-256     7c7987bc2432f249246529261b7da264c3a4b981ade86f8fcaeb9d5351e14601
API dist manifest SHA-256 a09980c62e796559f2632d4b7367009d3ab0b6fa2713ae5e1e03d7c5e058d847
```

演练结束后再次校验 52 个 dist 文件未变化。这把执行代码、配置、数据库前置条件与原始证据绑定，同时不记录 DATABASE_URL、用户名、密码或完整环境变量。

`country invalidation` 由 ignored、一次性、信号驱动的 DI harness 调用真实 `ReadonlyResponseCache.invalidateCountry("ID")`。它没有新增受支持或提交到生产代码的 HTTP、后台或 CLI 入口，也没有改变生产权限边界。

## 2. 缓存 TTL 与国家失效

| 场景 | 结果 | DB / 隔离判定 |
|---|---|---|
| `AE/en` 首次、立即重复、TTL 后再次读取 | `miss → hit → miss`；34.270 / 2.899 / 17.340 ms | detail cache miss `+2`、hit `+1`，DB operation `+2` |
| 失效前列表、`ID/en`、`VN/en` | 三个 key 均先达到 `miss → hit` | 控制日志确认固定失效国家为 `ID` |
| 失效后的列表、`ID/en`、`VN/en` | `miss / miss / hit`；18.252 / 15.894 / 2.233 ms | 列表和 ID 被清除，其他国家详情未被误删 |

这证明单进程失效原语正确，不代表运营人员已经具备生产触发能力，也不证明多实例即时传播。

## 3. PostgreSQL 暂停、降级与恢复

演练先清空缓存，建立一个过期的 `ID/en` entry 和一个 fresh 的 `ID/zh-CN` entry。证据显示随后精确终止了 1 条 idle `application_name='navigator-api'` 连接，再对固定测试容器执行真实 `docker pause`；容器状态为 `Running=true`、`Paused=true`。

| 数据库暂停期间的请求 | HTTP / cache | 总耗时 | 判定 |
|---|---|---:|---|
| fresh `ID/zh-CN` | `200 / hit`，无 stale header | 3.555 ms | 不访问数据库，body 正常 |
| stale `ID/en` | `200 / stale`，`X-Navigator-Data-Stale: 1` | 6.177 ms | body 与故障前 prime 完全一致 |
| no-cache `VN/en` | `500`，无 cache / stale header | 1.006681 s | 固定 `INTERNAL_ERROR` envelope，未回退 canonical |
| `/health/ready` | `503 {"status":"not_ready"}` | 506.543 ms | `Cache-Control: no-store` |
| `/health/live` | `200 {"status":"ok"}` | 2.192 ms | `Cache-Control: no-store` |

解除同一个容器的 pause 并等待 `pg_isready` 后，readiness 在 17.145 ms 恢复 200；`VN/en` 为 26.723 ms miss → 3.263 ms hit，`ID/en` 为 16.790 ms miss → 3.923 ms hit。故障响应没有污染缓存，恢复后可以重新填充。

本演练验证的是“已有空闲连接被终止后，数据库仍处于 pause，新连接受 `connect_timeout` 约束”的真实故障路径。它没有验证已建立连接上的执行中查询被 pause、TCP blackhole 或数据库长期不返回结果；`connect_timeout` 和 `pool_timeout` 也不等于 statement timeout。上线真实生产流量前，应另行评审服务端 `statement_timeout` 或可取消查询时限，并对已建立连接冻结路径专项演练。

## 4. 连接池等待超时

固定测试 backend 先取得 `countries` 表的 `ACCESS EXCLUSIVE` 锁，10 个不同列表 cache key 随后同时进入真实 Prisma 查询：

- PostgreSQL `pg_stat_activity`：`navigator-api` total 10、`wait_event_type='Lock'` 10；
- API metrics：`navigator_db_operations_in_flight{operation="country_list"} = 10`；
- 第 11 个新 key 在 1.029427 秒返回受控 500，日志分类为 `http_request_internal_database_unavailable`；
- 精确终止唯一 `application_name='navigator-task9-lock'` backend 后，前 10 个请求均返回 `200 / miss`，耗时范围 1.570981–1.581563 秒，平均 1.576342 秒；
- 最终 country-list in-flight 回到 0，测试锁 backend 计数回到 0。

这项结果只证明 pool=10、pool timeout=1 秒的演练配置；生产实例数和总连接预算仍以容量基线报告为准。

## 5. 优雅停机与清理

一次性 harness 启动日志记录精确 PID `2671011`；只向该 PID 发送 `SIGTERM`：

- 关闭前 PostgreSQL 有 10 条正常 idle `navigator-api` 连接；
- 进程 wait status 为预期的 143；
- API 3100 和 metrics 9464 两个 loopback 端口均关闭；
- PostgreSQL 中 `application_name='navigator-api'` 的连接为 0；
- 固定测试容器随后被停止并因 `--rm` 自动删除，DB 55434 端口也已关闭。

本项验证进程接收 SIGTERM 后释放本地监听和 Prisma 连接；生产发布仍必须先 not-ready、等待负载均衡摘流，再 drain 已接收请求，不能把直接发信号等同于完整编排流程。

## 6. 失败尝试与判定纪律

最终通过目录只包含干净重跑；此前未通过的 harness 尝试完整保存在 `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-m1-attempts/`，不参与最终 metrics、API log 或通过判定：

- 首次 outage 尝试只等待 2.2 秒；宿主墙钟在等待期间回拨，后发请求的日志时间反而早 348 ms，`ID/en` 因此仍为 hit。
- 首次 pool 尝试的 10 个 curl 客户端上限为 20 秒；两次外部工具调用之间出现约 27 秒调度间隔，客户端先返回 status 000，API 记录 10 个 499。

历史目录的新清单覆盖除自身外 187 个文件，SHA-256 为 `b02c484f7f208ecd1f9791dc7c64a9fcb96deaedf8233047566d9de0d953adc8`；其中还保留旧路径下清单的原始 bytes，其 SHA-256 为 `87cbfa51693d7dd65c9ea29b80da72e423d9e9f5a8aebc150aa0a8e5ddd3658d`。失败证据没有被删除、改写或混入最终成功数字。

## 7. 最终证据完整性与安全

最终原始证据位于 `/home/kevin/navigator/artifacts/platform-ops/task9-20260719-m1/`，被 `.gitignore` 排除，不提交到 Git。`manifest.sha256` 覆盖除自身外全部 141 个文件；清单自身 SHA-256 为 `30dfb1bb335c708cb7ae4d641e0ca3de77f493d60e52e62bb6c065e3bcaaa6f5`。

| 关键证据 | SHA-256 |
|---|---|
| `setup-counts.txt` | `079de5b5a612f388d087eb9e775520ded49a34fada96962a1f67697621412d69` |
| `setup-integration.log` | `f09f98baad3b1649c2186b49aafb852b99af2b05fcf49328b31eb5e7fad7ce21` |
| `environment.json` | `7c7987bc2432f249246529261b7da264c3a4b981ade86f8fcaeb9d5351e14601` |
| `api-dist-manifest.sha256` | `a09980c62e796559f2632d4b7367009d3ab0b6fa2713ae5e1e03d7c5e058d847` |
| `phase-summary.json` | `795a02f776a05b5219843fa4dc9d6e44aa55e3a0b79c7a0919da09561acc28d6` |
| `api.log` | `dd5b6f2422edca086da164889c8a2d868d409a941c9a22d42342ccf487a4e034` |
| `outage-paused-state.json` | `a2919284c1d221e0ef78949416599d7003276fe84a14d3faeba31853bf8eaa0f` |
| `pool-saturated-pg-activity.csv` | `827296178edb15ef314535775872461a45972ea9cb3b2d3af34e50899b8c66dd` |
| `graceful-result.json` | `e9facb43de7a40778bd13587429e6213a0c4e2208a2f1b2aedd6715ae3914a0e` |
| `task9-wrapper.mjs` | `4c30e007336c7c502197b3732d24a4d4a19f20bfbd9bb1348919f8a86168f879` |

独立完整性预检确认：最终清单 141 项全部通过；`api.log` 的 42 条 JSON 记录均可解析；另有 1 条从同一日志逐字摘录的 overflow JSONL 便于定位，不重复计数；40 个 JSON / meta 全部可解析。Task 8 原始清单和历史失败目录新清单也全部通过。最终 Task 9 artifact 中未发现 DATABASE_URL、测试密码、PostgreSQL URL、Authorization、Bearer 或 API key。

## 8. 未宣称完成的生产能力

- 当前没有经过鉴权、审计、幂等和多实例传播设计的生产 cache invalidation 入口。它应随获批的后台发布流程建设，不能临时暴露无鉴权 endpoint。
- 已建立连接上的执行中查询冻结尚未受 statement timeout 演练保护。
- 多实例本地缓存一致性、数据库自动故障转移、LB 摘流和跨故障域恢复仍应按容量基线的进入条件与季度演练执行。
- AI、会员、计费、导出、报告、后台写入和 ID STANDARD 正式数据均不在本轮运行时范围内。

在上述边界内，M1 Task 9 故障演练判定为通过；任何扩大范围的生产能力仍需对应授权、实现和独立验证。
