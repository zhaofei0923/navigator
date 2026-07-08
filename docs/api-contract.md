# api-contract.md — 接口契约

> 本文件定义前后端**接口契约**。数据结构以 [data-schema.md](./data-schema.md) 为唯一事实来源，
> 覆盖等级行为以 [coverage-levels.md](./coverage-levels.md) 为准。本文件不重复定义字段，只定义「路由、入参、出参形态、错误、权限、双语」。
> 修改 AI 检索边界属于 AGENTS.md 第 11 节「需人工确认的操作」。

---

## 0. 通用约定

### 0.1 基础
- 协议：HTTPS，`Content-Type: application/json`。
- 版本前缀：所有接口以 `/api/v1` 开头。
- 后端：NestJS（除非任务卡指定 FastAPI）。
- 所有外部输入（query / body / 上传 / AI 提问）**必须服务端校验**，防注入（AGENTS.md 第 10 节）。数据库访问统一走 Prisma 参数化查询。

### 0.2 语言（i18n）
- 客户端通过以下任一方式指定语言，优先级从高到低：
  1. Query 参数 `?locale=zh-CN|en`
  2. 请求头 `Accept-Language`
  3. 默认 `zh-CN`
- 接口对**业务展示文本**有两种返回模式，由 `?textMode` 控制：
  - `textMode=localized`（默认）：`LocalizedText` 字段**已按 locale 拍平为字符串**，并附 `_i18nFallback` 标记缺失降级的字段。
  - `textMode=raw`：原样返回 `{ zh, en }` 双语结构（供 admin / 编辑端使用）。
- 降级规则遵循 [data-schema.md §2.1](./data-schema.md)：某语言缺失时回退另一语言，`localized` 模式下在 `_i18nFallback` 列出发生降级的字段路径，不报错。

### 0.3 统一响应包络
成功：
```json
{
  "success": true,
  "data": { },
  "meta": { "locale": "zh-CN", "textMode": "localized" }
}
```
分页：
```json
{
  "success": true,
  "data": [ ],
  "meta": { "locale": "zh-CN", "page": 1, "pageSize": 20, "total": 137 }
}
```
错误：
```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "Country not found", "details": null }
}
```

### 0.4 错误码
| code | HTTP | 含义 |
|------|------|------|
| `VALIDATION_ERROR` | 400 | 入参校验失败（`details` 含字段级错误） |
| `UNAUTHORIZED` | 401 | 未登录 |
| `FORBIDDEN` | 403 | 权限不足（会员等级门控） |
| `NOT_FOUND` | 404 | 资源不存在 |
| `RATE_LIMITED` | 429 | 触发限流（AI 接口） |
| `INTERNAL_ERROR` | 500 | 服务端错误（不泄露内部细节） |

### 0.5 分页与筛选通用参数
| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `page` | number | 1 | 页码 |
| `pageSize` | number | 20 | 每页条数（上限 100） |
| `industryTags` | string[] | — | 行业标签过滤（见 data-schema §7.1） |
| `techTags` | string[] | — | 技术标签过滤（见 data-schema §7.2） |
| `region` | string | — | 地区过滤（见 data-schema §7.3） |

---

## 1. 国家列表与筛选

### `GET /api/v1/countries`
用于地图与国家列表页。

**Query**：`page`、`pageSize`、`region`、`industryTags`、`techTags`、`coverageLevel`（可选，筛选覆盖等级）。

**返回**：`data` 为国家卡片数组，每项包含：
- `code`、`name`、`region`、`flagEmoji`、`summary`、`coverageLevel`、`updatedAt`
- `moduleCoverage`（各模块 `status` 摘要，供列表标记）
- `signals`（可选派生字段，见 [scoring-framework.md](./scoring-framework.md)，用于机会、风险、政策友好度、推荐优先级等重点信号；不代表新增持久化模型字段）

> 详细字段见 [data-schema.md §4](./data-schema.md)。

---

## 2. 国家详情

### `GET /api/v1/countries/:code`
`:code` 为 ISO 3166-1 alpha-2（大写）。

**返回**：国家骨架 + 各模块覆盖状态（不含各模块明细数据，明细走 §3 按模块拉取，避免单次响应过大）。
- `code`、`name`、`region`、`flagEmoji`、`summary`、`coverageLevel`、`moduleCoverage[]`、`updatedAt`

**错误**：国家不存在返回 `NOT_FOUND`。

---

## 3. 模块数据

### `GET /api/v1/countries/:code/modules/:moduleKey`
`:moduleKey` 为 [data-schema.md §1.3](./data-schema.md) 的 10 个固定模块之一。

**行为**：
- 模块 `status = BUILDING` 时，返回 `{ status: "BUILDING", items: [] }`，**HTTP 200**（前端渲染占位，不视为错误）。
- 列表型模块返回分页 `items`；对象型模块（`market-overview` / `entry-strategy`）返回单对象 `item`。
- 仅返回 `reviewStatus = published` 且 `credibility != UNVERIFIED` 的数据（除非 admin 端带权限，见 §7）。

**返回示例（列表型，localized 模式）**：
```json
{
  "success": true,
  "data": {
    "moduleKey": "policy",
    "status": "PARTIAL",
    "items": [
      {
        "id": "pol_001",
        "title": "可再生能源上网电价政策",
        "summary": "...",
        "policyType": "incentive",
        "effectiveDate": "2024-03-01",
        "authority": "能源与矿产资源部",
        "source": "MEMR 官网",
        "sourceUrl": "https://...",
        "updatedAt": "2025-11-02T00:00:00Z",
        "credibility": "OFFICIAL"
      }
    ],
    "_i18nFallback": []
  },
  "meta": { "locale": "zh-CN", "page": 1, "pageSize": 20, "total": 3 }
}
```

**校验**：非法 `moduleKey` 返回 `VALIDATION_ERROR`。

---

## 4. 国家对比（Deferred）

> 国家对比不属于当前 MVP 四板块范围，暂不作为 P2 开发入口。
> 保留下列契约草案仅供后续恢复能力时参考；恢复前必须先更新 `roadmap.md` 与 `testing.md`。

### `GET /api/v1/compare`
**Query**：`codes`（逗号分隔的 ISO 码，2–4 国）、可选 `modules`（限定对比的模块）。

**返回**：`data` 为按模块组织的对比矩阵，每个模块给出各国的关键指标/摘要，缺失模块以 `status: BUILDING` 标记。

**校验**：`codes` 少于 2 或多于 4 返回 `VALIDATION_ERROR`。

---

## 5. AI 出海顾问（RAG）

> 本节接口的检索边界受 AGENTS.md 第 9 节红线约束，**不得在实现中放宽**。

### `POST /api/v1/ai/ask`
**Body**：
```json
{
  "question": "印尼光伏组件本地化要求是什么？",
  "countryCode": "ID",
  "locale": "zh-CN",
  "filters": { "industryTags": ["solar"], "moduleKeys": ["policy"] }
}
```

**服务端强制规则**：
1. **检索过滤硬约束**：仅检索 `reviewStatus = 'published'` 且 `aiUsable = true` 且 `credibility != 'UNVERIFIED'` 的知识片段（见 [data-schema.md §3.1](./data-schema.md)）。
2. **回答语言**：必须与 `locale`（或问题语言）一致；引用双语数据时取对应语言版本，缺失时降级并标注「未翻译」。
3. **强制附带**：每个回答必须返回 `sources`（来源）、`updatedAt`（引用数据更新时间）、`riskNote`（风险提示）。缺任一项视为不合格。
4. **无数据**：检索不到有效片段时，`answer` 明确为「暂无数据 / No data available」，`sources` 为空，禁止编造。
5. **输入校验与注入防护**：`question` 服务端校验长度与内容；对检索到的外部来源内容做转义隔离，防 prompt 注入。
6. **限流**：按用户/IP 限流，超限返回 `RATE_LIMITED`。

**返回**：
```json
{
  "success": true,
  "data": {
    "answer": "...",
    "sources": [
      { "title": "...", "sourceUrl": "https://...", "credibility": "OFFICIAL", "updatedAt": "2025-11-02T00:00:00Z" }
    ],
    "riskNote": "政策可能调整，请以官方最新公告为准。",
    "locale": "zh-CN"
  }
}
```

---

## 6. 留资 / 线索

### `POST /api/v1/leads`
**Body**：`name`、`contact`（必填）、`company`、`interestedCountry`、`source`（可选）。

**规则**：
- 服务端校验所有字段；`contact` 加密存储，禁止在响应/日志明文回显（AGENTS.md 第 10 节）。
- 返回仅确认 `{ success: true, data: { id } }`，不回显敏感信息。

---

## 7. 权限与会员门控

- **报告下载**（`reports` 模块 `accessLevel = MEMBER|PREMIUM`）、**伙伴联系方式**、**数据导出**必须做**服务端权限校验**，禁止仅靠前端隐藏（AGENTS.md 第 10 节）。
- 受控资源接口：
  - `GET /api/v1/countries/:code/reports/:id/download` — 校验会员等级，未授权返回 `FORBIDDEN`，未登录返回 `UNAUTHORIZED`。
  - `POST /api/v1/export` — 服务端校验导出权限。
- Admin 端接口（`/api/v1/admin/*`）需管理员鉴权，可返回 `draft` / `pending` / `UNVERIFIED` 数据并支持 `textMode=raw`；普通 C 端接口只返回 `published` 且 `credibility != UNVERIFIED` 的数据。

---

## 8. 一致性检查清单

- [ ] 所有接口路由以 `/api/v1` 开头
- [ ] 出参数据结构与 [data-schema.md](./data-schema.md) 一致，无特例字段
- [ ] `BUILDING` 模块返回 200 + 占位，不返回错误
- [ ] 展示文本按 `textMode` 处理，降级字段记入 `_i18nFallback`
- [ ] AI 接口强制 §5 的检索过滤、回答语言、来源/更新时间/风险提示
- [ ] 受控资源做服务端权限校验，未授权返回 `FORBIDDEN`/`UNAUTHORIZED`
- [ ] 留资敏感字段加密、不回显
- [ ] 每个接口附带测试（AGENTS.md 第 8 节）
