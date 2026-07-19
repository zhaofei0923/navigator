# PLATFORM-OPS-1：M1 容量基线与服务器要求

> **SUPERSEDED / 不可用于 M1 放行（2026-07-19）**：本页下列旧实测把生命周期累计 event-loop mean 的逐秒读数再次汇总后误标为 event-loop p99，无法证明 `< 50ms` 门槛。旧吞吐、HTTP 延迟、缓存、CPU、RSS 与连接数据仅作为历史观测保留；三档“整体承载”结论及基于它的服务器建议当前均为待复测状态。修复后的固定 1 秒窗口 p99 必须在新的 immutable run 中完整重跑 `100k` / `1m` / `10m`，在此之前不得引用本页旧判定宣称 Task 8 或 M1 容量验收完成。

- 基线日期：2026-07-19
- 实测代码：`e46b33d4d4f6fbe638edbe9dd74c362012ccf68e`
- 结论：旧运行的 event-loop 证据失效，`100k`、`1m`、`10m` 三档整体判定均待重跑
- 适用范围：6 个已发布 BASIC 国家、国家列表/详情/模块只读 API、AI 占比 0、写入占比 0

## 1. 结论边界

旧运行观测到：在下述实测环境和固定请求矩阵下，一个 NestJS API 进程完成了最高 556 RPS 的请求负载；但 event-loop 门槛证据失效，所以它不能继续作为“三档均满足 M1 阈值”或“556 RPS 已验证承载点”的完整证明。本轮没有继续加压寻找崩溃点。

固定矩阵只有 120 个请求键，实测 cache hit 为 94.28%–99.90%，高于容量模型的 80%。因此，本轮直接证明的是高缓存命中的 API 吞吐，不等于已经对 PostgreSQL 施加了模型中的 111.2 DB RPS；数据库规格不得按本轮低查询水位激进下调。

本报告中的 `100k` / `1m` / `10m` 指每日 HTTP 请求数，不是独立访客数。若业务预测使用 DAU，应先换算为：

```text
dailyRequests = DAU × 每用户每日会话数 × 每会话 API 请求数
```

以下内容不在本轮容量结论内：

- AI 顾问、向量检索、模型调用与流式回答；
- 会员、计费、导出、报告生成、后台写入和批量任务；
- Next.js SSR、图片与静态资源带宽；
- STANDARD / COMPLETE 深层数据、大响应体或超过 6 国的数据规模；
- 多实例缓存一致性、跨实例限流和会话状态。

上述能力进入流量前必须另做容量测试，不能直接套用本表。

## 2. 固定容量模型

M1 模型使用以下不可变假设：峰值小时承载全天 10% 请求、突发系数 2、读占比 100%、写占比 0、规划 cache hit 80%、AI 占比 0。

| 每日请求 | 平均 RPS | 规划峰值 RPS | 规划 DB RPS |
|---:|---:|---:|---:|
| 100,000 | 1.1574 | 6 | 1.2 |
| 1,000,000 | 11.5741 | 56 | 11.2 |
| 10,000,000 | 115.7407 | 556 | 111.2 |

每档固定预热 120 秒、正式计量 600 秒；120-key 请求矩阵为 60% 列表、30% 详情、10% 模块，覆盖 6 国、`zh-CN` / `en` 两种语言，只发 loopback GET，不访问 AI、写接口、DNS 或外网。

## 3. 实测环境

| 项目 | 实测值 |
|---|---|
| API | NestJS production build，单进程，loopback bind |
| 数据源 | PostgreSQL，导入后计数 `6 / 60 / 6 / 0`（国家 / 模块覆盖 / 市场概览 / knowledge chunks） |
| 数据库镜像 | `pgvector/pgvector:pg17@sha256:d2ef61f42ef767baa5a1475393303cc235bcd92febd9d7014eddb48b41f3bad0` |
| Node.js | `v24.18.0` |
| Prisma | `6.19.3` |
| PostgreSQL | `17.10` |
| API pool | 最大 10，pool timeout 5 秒，connect timeout 5 秒 |
| 只读缓存 | TTL 60 秒，stale-if-error 300 秒，最多 1,000 entries |
| readiness | 1,000 ms timeout |
| CPU 容量 | 32 cores，来源 `host-available-parallelism` |
| 内存容量 | 67,047,694,336 bytes（62.44 GiB），来源 `host-total-memory` |
| scenario SHA-256 | `70f91e9fe73c4bc6e80af21ffb3f1ed33fa13cc715ca8d1acf992ef55241d059` |

CPU 和内存来源是宿主机回退值，说明本轮没有对 API 施加 2 vCPU / 4 GiB 等云机规格的 cgroup 限额。因此，本轮直接验证的是上述宿主环境；第 6 节的小规格是保守的首发建议，正式采购或上线前仍需在相同限额下复测。

## 4. 三档实测结果

### 4.1 吞吐、延迟与缓存

| 每日请求 | 目标 / 达成 RPS | 窗口内完成 / 请求 | 丢弃 / 晚到 | 5xx | p95 | p99 | cache hit | 判定 |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 100,000 | 6 / 6.000000 | 3,600 / 3,600 | 0 / 0 | 0 | 15.41 ms | 18.04 ms | 94.28% | 整体待重跑 |
| 1,000,000 | 56 / 56.000000 | 33,600 / 33,600 | 0 / 0 | 0 | 3.81 ms | 4.35 ms | 99.24% | 整体待重跑 |
| 10,000,000 | 556 / 555.998333 | 333,599 / 333,600 | 0 / 1 | 0 | 2.95 ms | 3.60 ms | 99.90% | 整体待重跑 |

`10m` 的 1 个晚到请求在 600 秒窗口边界后完成，不是错误或丢弃；请求账目满足 `完成 + 晚到 + 丢弃 = 请求数`，达成率为 99.9997%。三个结果文件均包含 600 个单秒样本，API 指标区间之和分别约为 600 秒。

### 4.2 API 与数据库资源

| 每日请求 | CPU p95 | CPU p95 / 容量 | RSS p95 | RSS max | RSS max / 容量 | 失效的旧 event-loop 口径 | DB active / total 峰值 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100,000 | 0.022083 cores | 0.0690% | 144.63 MiB | 144.63 MiB | 0.2262% | 21.24 ms | 1 / 1 |
| 1,000,000 | 0.089940 cores | 0.2811% | 231.26 MiB | 231.26 MiB | 0.3617% | 21.13 ms | 0 / 1 |
| 10,000,000 | 0.250547 cores | 0.7830% | 287.79 MiB | 288.54 MiB | 0.4512% | 20.81 ms | 0 / 4 |

RSS 容量阈值按整个测量窗口的 `max` 判定，不用 p95 替代。DB 连接按三个顺序场景、JSONL 行顺序及结果文件落盘时间粗分段；整个运行的 active 峰值为 1、total 峰值为 4。采集器的 2,133 条墙钟时间戳中有 72 次负向跳变（最小 -1,672 ms），因此不能把墙钟值当作精确逐秒关联依据；行顺序和全程连接峰值仍有效。active 是每秒快照，也可能错过短查询，容量门槛以全程 total 连接峰值为主。

上表 event-loop 三个数值来自失效旧口径，只为可追溯性保留，不能视为 p99 或通过值。

### 4.3 阈值判定

| 阈值 | 100k | 1m | 10m |
|---|---:|---:|---:|
| achieved RPS ≥ 95% | 通过 | 通过 | 通过 |
| 5xx < 0.1% | 通过 | 通过 | 通过 |
| p95 < 150 ms | 通过 | 通过 | 通过 |
| p99 < 300 ms | 通过 | 通过 | 通过 |
| cache hit ≥ 80% | 通过 | 通过 | 通过 |
| event-loop p99 < 50 ms | 证据失效 | 证据失效 | 证据失效 |
| DB total peak ≤ 7 / 10 | 通过 | 通过 | 通过 |
| CPU p95 ≤ capacity 70% | 通过 | 通过 | 通过 |
| RSS max ≤ capacity 75% | 通过 | 通过 | 通过 |

## 5. 原始证据与完整性

原始文件位于 `/home/kevin/navigator/artifacts/platform-ops/`，被 `.gitignore` 排除，不提交到 Git。完整性清单自身 SHA-256 为 `b358498956fca3522472743d376a8c9da9163b1bbceedc97913b13e71ab62878`。

| Artifact | SHA-256 |
|---|---|
| `environment.json` | `43e10724cda5230d8477fd7f7ada9e2ca5b6d5ec9c725bd5a9868d418b5fa0da` |
| `api.log` | `e35b5d2a8977fc5704cd5a7261ad4a5ed545a51c11727d824642827349d773bc` |
| `pg-connections.jsonl` | `cc0faf69bdc78f8a90eefd51681866a41369fd74fa9879f0b8bbcc20c3881f5b` |
| `100k.json` | `f98e2d20312120c4aa674bf1b5b6aa218a5f2827dfbd10b514a28388aa1a6d6b` |
| `1m.json` | `e15478ac3cfff4d860238ce08de49250fa55c1cd0c923a342b679c16b83fb15e` |
| `10m.json` | `3aa4845a6ca1f3ef24d4de83ad497988b5d6e2bf6df1a8a879465306c16cf74b` |

独立完整性预检已确认：

- 444,975 行 API JSONL 全部可解析，5xx 行为 0；
- 2,133 行 PostgreSQL JSONL 全部可解析，字段和计数关系有效；
- 三个结果 JSON 结构、Git SHA、600 个样本、状态计数、请求账目和测量时长一致；
- `manifest.sha256` 六项均通过 `sha256sum --check`；
- artifact 中未发现 DATABASE_URL 或测试密码。

## 6. 首发服务器建议

下表是生产首发规格建议，不是已在这些小规格上完成的实测。建议在采购前用 cgroup / 容器施加相同 CPU、RAM 限额，重跑三档中对应场景；未复测前不得把建议规格标记为“已验证”。

| 每日请求 | Web / Edge | API 建议 | PostgreSQL 建议 | 存储与连接预算 |
|---:|---|---|---|---|
| 100,000 | CDN + WAF；生产 2 × 1 vCPU / 2 GiB Web；可接受单点时可从 1 个开始 | 生产 2 × 2 vCPU / 4 GiB；低成本单机可 1 × 2 vCPU / 4 GiB | 主库与跨故障域热备各 2 vCPU / 8 GiB | 100 GiB SSD；API pool 稳态 20 / 发布峰值 30，DB `max_connections` 至少 60，其中至少 20 条固定运维预留 |
| 1,000,000 | CDN + WAF + L7 LB；2 × 2 vCPU / 4 GiB Web | 2 × 2 vCPU / 4 GiB，滚动发布保持 N+1 | 托管 Multi-AZ 或等效，主备各 4 vCPU / 16 GiB | 200 GiB SSD/NVMe；API pool 稳态 20 / 发布峰值 30，DB `max_connections` 至少 80，其中至少 20 条固定运维预留 |
| 10,000,000 | CDN + WAF + L7 LB；3 × 2 vCPU / 4 GiB Web，多可用区 | 3 × 4 vCPU / 8 GiB，N+1 与横向扩容 | 托管 Multi-AZ 或等效，主备各 8 vCPU / 32 GiB | 500 GiB NVMe/可配置 IOPS；API pool 稳态 30 / 发布峰值 40，DB `max_connections` 至少 100，其中至少 20 条固定运维预留 |

说明：

- Web / Next.js SSR 未在本轮测试。优先使用静态化、ISR 和 CDN；若核心页面必须高比例 SSR，需独立压测 Web 层。
- 生产建议从 2 个 API 实例起步是为了可用性和滚动发布，不代表单实例在本轮吞吐不足。
- PostgreSQL 规格为数据增长、备份、维护和未命中查询预留余量，不能由当前 6 国小数据集的低连接数直接下调。
- 10m 档没有直接验证 80% cache hit 时约 111.2 DB RPS；上线前应使用更大 key 空间或独立 DB 读取场景补测这一点。
- 表中的发布峰值按 `maxSurge = 1` 且没有额外 HPA 副本计算。启用 HPA 或紧急扩容前必须重新计算并限制最大并存实例数。
- 当前 API 固定绑定 `127.0.0.1`。每个 API 实例必须同主机或同网络命名空间部署受控反向代理 / sidecar，由它连接 loopback；中央 L7 LB 只连接该代理，不能直接连接 API。若将 API 改绑私网地址，属于部署 / 代码边界变更，必须复测。

连接预算必须使用以下口径，不能把全部 `max_connections` 分给 API：

```text
最大 API pool 预留 = 最大并存 API 实例数（含 rollout surge / HPA max）× 10
API 可用连接预算 = max_connections - 20 条固定运维/迁移/备份预留 - 后台/复制/监控客户端预算
API 实例硬上限 = floor(API 可用连接预算 / 10)
必须满足：最大 API pool 预留 ≤ API 可用连接预算
```

## 7. 技术框架要求与进入条件

### 7.1 当前 M1 必须保持

- Next.js Web 与 NestJS API 分离部署；API 保持 `127.0.0.1` loopback-only，由同主机 / 同网络命名空间代理接入内部网络，中央 LB 只暴露该代理；metrics 同样必须保持 `127.0.0.1` loopback-only，只允许本机 agent / sidecar 抓取，不经业务 LB 暴露。
- PostgreSQL + Prisma 参数化访问；单进程只创建一个 Prisma runtime，连接池必须有上限和超时。
- 只读 cache 必须保持 bounded、single-flight、TTL、stale-if-error 和 country invalidation 边界。
- liveness 与 readiness 分离；readiness 不得被 stale cache 伪装为健康。
- JSON 结构化日志、低基数 metrics、trace / request ID、5xx / latency / cache 指标必须持续采集。现有 `navigator_db_operations_in_flight` 只表示逻辑 DB 操作，严禁命名或解释为真实连接数。
- TLS 1.2+、HSTS、WAF、限流、密钥环境变量、服务端权限校验和数据库私网访问必须在生产启用。

生产真实 DB `active` / `total connections` 必须来自托管 PostgreSQL 指标，或另行批准的安全 exporter / collector；Task 8 的 collector 仅用于隔离 benchmark，当前 API 没有真实 pool 水位指标。在该数据源上线前，任何连接类扩容规则都不能标记为已自动执行。

### 7.2 横向扩容触发点

满足任一条件并持续 10 分钟时，增加 API 实例或进入专项诊断：

- 单实例 CPU p95 ≥ 60%；
- RSS ≥ 实例内存 65%；
- event-loop p99 ≥ 40 ms；
- API p95 ≥ 100 ms，或 p99 ≥ 200 ms；
- 5xx ≥ 0.05%；
- 由托管 PostgreSQL / 已批准 exporter 观测到的 API 实际 total connections / API 可用连接预算 ≥ 70%；
- cache hit < 80%，或响应体 / 数据规模较本轮增长 2 倍。

### 7.3 Redis、外部 pooler 与 APM

这些组件尚未获批实施，本报告只给进入条件：

- **Redis / 共享缓存**：country invalidation 当前只在单进程内生效。正常数据库可用时，多实例最迟约在 TTL 60 秒后收敛；数据库暂时不可用并命中 stale 时，旧值最长可服务约 `60 + 300 = 360` 秒。若要求即时跨实例失效、共享限流或共享会话，需评审共享 invalidation / pub-sub；获批前只能通过全实例受控 drain / restart 等发布流程清空本地 cache。
- **PgBouncer / 外部 pooler**：`API 实例数 × 10` 超过 API 可用连接预算 60%，或 API 实际 total connections / API 可用连接预算持续超过 70% 时进入评审。
- **APM**：进入 1m 日请求生产档、出现跨服务延迟，或仅靠现有 logs / metrics 无法定位 SLO 问题时进入评审。
- **只读副本**：主库 CPU 或 read I/O 持续超过 60%，且确认主要瓶颈为可复制的读取后进入评审。

不得为了达到表面指标擅自引入依赖；上述变更仍需按人工确认和独立压测流程执行。

## 8. 备份、恢复与发布要求

- PostgreSQL：每日快照 / 全量备份 + 连续 WAL 归档，至少保留 30 天，并保留异地副本。
- 1m / 10m 档必须使用托管 Multi-AZ 或等效方案；100k 生产档也建议主备跨故障域。低成本取消 Web、API 或 DB 冗余时，必须明确标记对应单点，且不再满足本表的生产 HA 建议。
- 数据库 HA 必须定义复制模式、统一连接端点、受控 promotion、旧主 fencing 和自动 / 人工故障转移责任人；Web 与 API 生产副本必须跨至少两个故障域分布。
- 初始目标：RPO ≤ 5 分钟、RTO ≤ 60 分钟；未完成真实恢复演练前只能标记为目标，不能标记为已验证。
- 至少每月执行一次隔离恢复演练，验证 schema、6 国数据计数、应用 readiness 与关键只读接口。
- 至少每季度执行一次受控数据库故障转移演练，验证统一端点、fencing、连接恢复、RPO / RTO 和回切流程。
- 发布使用滚动或蓝绿方式；先将实例标记为 not-ready，等待 LB 摘流与路由传播，再 drain 已接收的 in-flight 请求并执行进程优雅关闭，只有超过宽限期才强制终止。
- CDN 仅缓存静态资源和明确允许的公开 GET；会员、权限、导出、报告与个性化响应不得误缓存。

## 9. 必须重跑容量基线的变更

出现任一情况时，本报告失效或需要增量复测：

- ID STANDARD 或任一 STANDARD / COMPLETE 数据正式发布并进入运行时；
- 发布国家数、典型响应体或数据库行数达到本轮 2 倍；
- AI 占比从 0 变为非 0；
- 增加会员、计费、导出、报告、后台写入或定时任务流量；
- 改变 Prisma、PostgreSQL、缓存、连接池、部署拓扑或实例规格；
- 从单实例切换到多实例并要求强缓存一致性；
- P95、event-loop、DB 连接、CPU 或 RSS 达到第 7.2 节触发点。

AI Beta 必须单独测量模型并发、token 吞吐、向量查询、队列等待、超时、成本与供应商限流；本轮 556 RPS 不能作为 AI 顾问容量。
