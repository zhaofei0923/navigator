# BASIC Profile 国家页展示设计

**日期：** 2026-07-21

**范围：** Web 国家详情页的 `market-overview` 展示

**状态：** 方案 A 已获用户批准，待书面规格复核

## 1. 问题与目标

印度尼西亚 BASIC r3 已将 `basic-market-profile/v2` 写入 canonical、PostgreSQL，API
也能从 `market-overview.item.basicProfile` 返回本地化后的八类数据；但 Web
`CountryDetail` 只读取旧版概览、关键指标和来源摘要，没有读取 `basicProfile`，导致
页面无法展示最新数据。

本次改动在现有 `market-overview` 模块内增加国家中立的 BASIC Profile 展示。目标是：

- 按固定顺序展示八个类别及全部字段；
- 同时展示可用值和 `NOT_AVAILABLE` 缺失说明；
- 将字段引用的 `sourceIds` 解析为具体发布机构、标题和可点击来源链接；
- 保持 `zh-CN` / `en` 同步本地化；
- 旧国家 `basicProfile = null` 时保持现有页面，不新增空区块或错误；
- 不改变数据库、API 契约、覆盖等级、AI 边界或十模块结构。

## 2. 方案选择

采用已批准的方案 A：在现有市场概览正文后追加完整八类 BASIC Profile。

未采用的替代方案：

- 只显示人口、GDP、通电率等摘要卡片：改动较小，但继续隐藏政策、市场摘要、缺失
  证据和具体来源，无法满足 BASIC v2 完整展示要求。
- 新增独立 BASIC 页面或标签：可获得更大空间，但会引入新的导航状态和页面层级，
  超出本次修复范围。

## 3. 页面结构

`market-overview` 的现有概览卡片和关键指标保持不变；当 `item.basicProfile` 是合法对象
时，在其后渲染：

1. BASIC 数据标题、说明和 Profile 更新时间；
2. 八个类别卡片，顺序严格为：
   `countryBasics`、`electricityMarket`、`energyAccess`、
   `renewableCapacity`、`solarResource`、`windResource`、
   `policyOverview`、`marketSummary`；
3. 每个类别内按 API 提供的固定字段顺序显示字段行；
4. 来源目录，仅列出当前 Profile 的所有来源。

桌面端类别卡片使用两列网格；窄屏降为一列。字段行使用定义列表语义，避免把长政策
摘要和缺失原因压入指标小卡片。

## 4. 字段展示规则

### 4.1 AVAILABLE

每行显示：

- 本地化字段标签；
- 格式化后的值；
- 单位和年份（存在时）；
- 核查日期；
- 引用来源链接；
- 可选说明 `note`。

数值使用当前语言的 `Intl.NumberFormat`：整数保留整数，小数最多显示两位；这只影响
展示，不修改 API 或存储值。`region` 等已有项目枚举优先复用现有 i18n 标签，其他
字符串按 API 本地化结果原样显示。单位作为数据内容显示，不把未知单位替换成 UI
文案。

### 4.2 NOT_AVAILABLE

字段仍占据固定位置，并显示：

- 本地化字段标签；
- 本地化的“暂无数据”状态；
- API 返回的本地化 `reason`；
- 核查日期；
- 已核查来源链接。

这保证用户能区分“页面漏数据”和“来源已核查但本批不可得”。

### 4.3 来源

组件先以 `basicProfile.sources[].id` 建立只读映射，再按字段 `sourceIds` 查找来源。
每个链接显示具体来源标题和发布机构，使用来源原始绝对 HTTP(S) URL，在新窗口打开并
设置 `rel="noreferrer noopener"`。字段引用不到来源时不猜测、不生成链接；契约校验应
已阻止该状态进入 API。

来源目录显示发布机构、标题、可信度、发布时间（存在时）和获取时间。所有固定 UI
标签均新增到两份语言包，key 集保持一致。

## 5. 组件边界

为避免继续扩大 `country-detail.tsx`，新增一个聚焦组件：

- `basic-profile.tsx`：识别并渲染 Profile、类别、字段和来源；只依赖 API
  `ModuleResponseRecord` 与 locale，不读取 canonical 文件或数据库。
- `country-detail.tsx`：只负责在 `ObjectModuleBody` 中把
  `item.basicProfile` 传给该组件；`null`、缺失或非对象时不渲染。

运行时只消费 API 已本地化的 JSON。组件使用窄化函数处理 `unknown`，禁止 `any`，
也不会在客户端重复定义或放宽 BASIC Profile 持久化契约。

## 6. 数据流与兼容性

```text
approved canonical
  -> PostgreSQL market_overviews.basic_profile
  -> API localized market-overview.item.basicProfile
  -> CountryDetail/ObjectModuleBody
  -> BasicProfileSection
```

- `basicProfile = null`：仅显示旧市场概览。
- 合法 v2 Profile：显示八类数据和来源。
- 前端收到意外形状：不抛出页面级异常，不渲染 Profile 区块；API/共享类型测试仍负责
  契约正确性。
- Profile 内翻译降级由现有 API formatter 完成，页面继续使用响应中的
  `_i18nFallback` 计数提示。

## 7. 测试设计

遵循测试驱动开发，先增加会因当前页面忽略 `basicProfile` 而失败的测试，再实现组件。

单元/渲染测试覆盖：

- 印尼中文页出现八个类别、人口、GDP、人均 GDP、通电率、政策摘要和市场摘要；
- 英文页显示对应英文标签与文本；
- `NOT_AVAILABLE` 字段显示缺失状态、原因、核查日期和来源；
- World Bank、IEA 等来源显示具体标题和链接，而不是笼统“外部公开来源”；
- `basicProfile = null` 的旧国家不显示 BASIC Profile 区块；
- 非法或缺失 Profile 不导致页面渲染失败；
- 中英文语言包 key 完全对齐。

渲染验证覆盖：

- `zh-CN/countries/ID` 页面成功加载且能看到 r3 人口、GDP、通电率和来源；
- 英文切换后同一区块同步显示英文；
- 桌面和移动视口无溢出、遮挡或框架错误；
- 至少验证一个来源链接的可见文本和目标 URL。

提交前执行 Web 定向测试、根级 `lint`、`typecheck`、`test` 和项目 Playwright E2E；
合并后重建展示服务并再次访问实际 Docker PostgreSQL 数据。

## 8. 非目标与安全边界

本任务不：

- 修改 BASIC Profile 字段清单或数据模型；
- 采集、补写或推断 `NOT_AVAILABLE` 数值；
- 修改 canonical、批准回执或其他国家数据；
- 启用 `aiUsable` 或生成知识片段；
- 修改会员、权限、计费或 AI 检索边界；
- 将前后端容器化。

## 9. 验收标准

印尼国家页必须从 API 响应渲染完整八类 r3 Profile，用户可看到每个字段的状态、
核查日期和具体来源。API 中存在而页面未展示的 Profile 字段视为失败；旧版空 Profile
兼容、双语一致、测试与渲染验证全部通过后方可合并。
