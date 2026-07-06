# env-config.md — 环境变量与配置约定

> 落实 AGENTS.md 第 10 节安全红线：**禁止在代码、日志、前端暴露密钥/凭证**，一律走环境变量 + `.env`（`.env` 不入库）。
> 本文件是环境变量的**唯一清单来源**。新增变量必须先在此登记。

---

## 0. 总则

1. 所有密钥、连接串、第三方凭证一律通过环境变量注入，**禁止硬编码**。
2. `.env` **不入库**（`.gitignore` 必含）；仓库提供 `.env.example` 作为字段模板（不含真实值）。
3. 前端只允许暴露带公开前缀的变量（`NEXT_PUBLIC_*` / `TARO_APP_*`），**严禁**把服务端密钥标为公开前缀。
4. 服务启动时校验必需变量（缺失即 fail-fast），校验逻辑集中在配置模块（NestJS `ConfigModule` + schema 校验）。
5. 日志中禁止打印任何密钥/连接串/用户联系方式（见 [testing.md](./testing.md) 与 data-schema §6）。

---

## 1. 变量命名约定

- 全大写 `UPPER_SNAKE_CASE`。
- 前缀区分作用域：
  - 无前缀 / `DATABASE_` / `AI_` / `AUTH_` 等：**服务端专用**，禁止暴露到前端。
  - `NEXT_PUBLIC_`：Web 前端可见（Next.js 约定）。
  - `TARO_APP_`：小程序 / H5 前端可见。
- 按 `.env.local`（本地）、`.env.test`（测试）、部署环境变量（生产）分环境注入，同名覆盖。

---

## 2. 变量清单（`.env.example` 模板）

> 下表即 `.env.example` 应包含的字段。真实值仅存在于本地/部署环境，绝不入库。

### 2.1 通用
| 变量 | 必需 | 示例/说明 |
|------|------|-----------|
| `NODE_ENV` | ✓ | `development` / `test` / `production` |
| `APP_BASE_URL` | ✓ | 服务对外基础 URL |
| `LOG_LEVEL` | — | `info`（默认）/ `debug` / `warn` / `error` |

### 2.2 数据库（PostgreSQL + Prisma + pgvector）
| 变量 | 必需 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✓ | Prisma 连接串（含账号密码，**服务端专用**） |
| `SHADOW_DATABASE_URL` | — | Prisma 迁移影子库（本地/CI） |
| `PGVECTOR_DIMENSION` | ✓ | 向量维度，须与 embedding 模型一致（见 [ai-advisor.md](./ai-advisor.md)） |

### 2.3 认证 / 会员（配合 [auth-membership.md](./auth-membership.md)）
| 变量 | 必需 | 说明 |
|------|------|------|
| `AUTH_JWT_SECRET` | ✓ | JWT 签名密钥（服务端专用） |
| `AUTH_JWT_EXPIRES_IN` | — | 令牌有效期，默认 `2h` |
| `AUTH_SESSION_COOKIE_NAME` | — | 会话/语言偏好 Cookie 名 |
| `LEAD_ENCRYPTION_KEY` | ✓ | 留资联系方式加密密钥（data-schema §6） |

### 2.4 AI 顾问（RAG）
| 变量 | 必需 | 说明 |
|------|------|------|
| `AI_PROVIDER` | ✓ | LLM 提供方标识 |
| `AI_API_KEY` | ✓ | LLM/embedding 密钥（服务端专用） |
| `AI_CHAT_MODEL` | ✓ | 问答模型名 |
| `AI_EMBEDDING_MODEL` | ✓ | 向量化模型名（须与 `PGVECTOR_DIMENSION` 匹配） |
| `AI_RATE_LIMIT_PER_MIN` | — | 单用户每分钟提问上限（默认见 ai-advisor.md） |

### 2.5 前端公开变量
| 变量 | 端 | 说明 |
|------|----|------|
| `NEXT_PUBLIC_API_BASE_URL` | Web | 前端调用的 API 基址 |
| `NEXT_PUBLIC_MAP_TOKEN` | Web | 地图（Mapbox）公开 token（仅公开权限） |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | Web | 默认语言，值 `zh-CN` |
| `TARO_APP_API_BASE_URL` | Mini | 小程序 API 基址 |

> `NEXT_PUBLIC_MAP_TOKEN` 必须是受域名限制的公开 token；私有密钥不得用此前缀。

---

## 3. 启动校验

- 后端在启动时用 schema（如 `zod` / class-validator）校验必需变量，缺失或格式错误 **fail-fast** 并输出**不含值**的错误（只报字段名）。
- 校验清单必须与本文件 §2 保持一致；新增必需变量须同时更新校验 schema 与 `.env.example`。

---

## 4. 安全约束（硬性）

- `.env`、`.env.local`、`.env.*.local` 一律进 `.gitignore`，**禁止入库**。
- 禁止在前端 bundle、日志、错误响应、AI 回答中出现任何密钥/连接串。
- 密钥轮换：更换 `AUTH_JWT_SECRET` / `AI_API_KEY` / `LEAD_ENCRYPTION_KEY` 属敏感操作，须走部署流程，不在代码中留历史值。
- 引入需要新密钥的第三方依赖属 AGENTS.md 第 11 节「需人工确认」，须在 PR 标注。

---

## 5. 一致性检查清单

- [ ] 新增变量已登记到本文件 §2 与 `.env.example`
- [ ] 服务端密钥无 `NEXT_PUBLIC_` / `TARO_APP_` 前缀
- [ ] `.env*` 已在 `.gitignore`
- [ ] 启动校验 schema 与本文件一致，缺失 fail-fast 且不泄露值
- [ ] 日志/前端/AI 回答不含密钥或用户敏感信息
