# auth-membership.md — 权限与会员门控规范

> 落实 AGENTS.md 第 10 节：**会员权限、数据导出、报告下载必须做服务端权限校验，禁止仅靠前端隐藏。**
> 修改权限、计费、会员等级逻辑属 AGENTS.md 第 11 节「需人工确认」，须在 PR 标注并等待 Review。
> 接口形态以 [api-contract.md](./api-contract.md) 为准，本文件定义「角色、等级、门控矩阵、校验规则」。

---

## 0. 总则

1. 一切受控资源的授权判断**在服务端完成**；前端隐藏只是体验优化，不构成安全边界。
2. 授权失败：未登录返回 `UNAUTHORIZED`(401)，已登录但等级不足返回 `FORBIDDEN`(403)。
3. 会员/计费的**具体价格与权益变更**属业务决策，本文件只定义技术门控模型；权益调整须人工确认。

---

## 1. 角色（Role）

| 角色 | 说明 |
|------|------|
| `GUEST` | 未登录访客 |
| `USER` | 已登录普通用户 |
| `ADMIN` | 运营/管理员（Admin 后台） |

> 角色与会员等级正交：`USER` 可叠加不同会员等级；`ADMIN` 拥有后台数据管理权限。

---

## 2. 会员等级（MembershipLevel）

对应 [data-schema.md §5.10](./data-schema.md) 的 `accessLevel` 枚举：

| 等级 | 定位 |
|------|------|
| `FREE` | 免费用户，可浏览公开数据 |
| `MEMBER` | 付费会员，解锁标准报告与伙伴联系 |
| `PREMIUM` | 高级会员，解锁全部报告、导出与深度 AI |

等级偏序：`FREE < MEMBER < PREMIUM`（高等级含低等级全部权益）。

---

## 3. 门控矩阵（资源 × 最低要求）

| 资源 / 动作 | 最低要求 | 说明 |
|-------------|----------|------|
| 国家列表 / 详情骨架 / 模块公开数据 | `GUEST` | 完全公开 |
| AI 顾问（基础问答） | `USER` | 需登录，受限流 |
| AI 顾问（深度/导出问答记录） | `PREMIUM` | 深度能力 |
| 伙伴联系方式（`partners.contactHint` 之外的完整联系） | `MEMBER` | 脱敏提示公开，完整联系门控 |
| 报告下载 `accessLevel=FREE` | `USER` | 登录即可 |
| 报告下载 `accessLevel=MEMBER` | `MEMBER` | — |
| 报告下载 `accessLevel=PREMIUM` | `PREMIUM` | — |
| 数据导出 `/api/v1/export` | `PREMIUM` | 服务端校验 |
| 留资提交 | `GUEST` | 公开，但联系方式加密存储 |
| Admin 后台（读写 draft/pending） | `ADMIN` | 独立鉴权 |

> 报告下载的最低要求取 `资源自身 accessLevel` 与「用户等级」比较，用户等级 ≥ 资源等级方可放行。

---

## 4. 服务端校验规则

1. **统一守卫**：所有受控接口经统一鉴权守卫（NestJS Guard）+ 等级校验装饰器，禁止在业务逻辑里散写判断。
2. **令牌**：JWT（`AUTH_JWT_SECRET`，见 [env-config.md §2.3](./env-config.md)），携带 `userId`、`role`、`membershipLevel`。
3. **资源级复核**：报告下载须服务端读取该报告 `accessLevel` 再比对用户等级，**不信任前端传入的等级**。
4. **越权防护**：禁止通过改前端参数（如伪造 `accessLevel`、他人 `userId`）绕过；一切以服务端会话为准。
5. **导出/下载**：生成的下载链接须为**短时效、绑定用户**的受控链接，禁止公开可枚举的静态地址。
6. **留资敏感数据**：`contact` 用 `LEAD_ENCRYPTION_KEY` 加密存储，响应/日志不回显（data-schema §6）。

---

## 5. 与 AI 顾问的关系

- 基础问答需 `USER`；超限返回 `RATE_LIMITED`（限流参数见 [ai-advisor.md](./ai-advisor.md)）。
- 深度问答 / 问答记录导出需 `PREMIUM`。
- 无论等级，AI 检索边界一律遵守 AGENTS.md §9 红线，**权限等级不放宽检索范围**（高等级用户也只能检索 `published + aiUsable`）。

---

## 6. 测试要求（配合 [testing.md §1](./testing.md)）

- 每个受控资源：等级充足→放行、等级不足→`FORBIDDEN`、未登录→`UNAUTHORIZED`。
- 越权用例：伪造前端参数不能绕过服务端校验。
- 下载链接时效与绑定用户校验。
- 留资 `contact` 加密存储且不回显。

---

## 7. 一致性检查清单

- [ ] 受控资源均服务端校验，未靠前端隐藏
- [ ] 角色/等级枚举与本文件一致
- [ ] 门控矩阵与 api-contract 受控接口对应
- [ ] 报告下载按资源 `accessLevel` 复核
- [ ] AI 检索范围不因等级放宽
- [ ] 留资敏感字段加密、不回显
- [ ] 权限/计费变更已在 PR 标注「需人工确认」
