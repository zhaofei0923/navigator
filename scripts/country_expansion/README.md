# 赞比亚新增国家资料包

本轮只追加赞比亚（ZMB / ZM），不重新采集、改写或重新审核既有国家。
原始资料含中国档案，因此由原始60国扩展为61国；对客海外范围由59国扩展为60国。
资料收集阶段仅生成扩展候选；用户随后确认集中审核Excel，赞比亚已接入原站点，当前对客提供60个海外国家。
当前发布版本、部署与回退操作、最终回归结果以[赞比亚增量发布记录](../../deploy/tencent/ZAMBIA_RELEASE_20260828.md)为准。

## 资料收集阶段交付（历史记录）

- 集中审核：`outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx`。
- 新全量索引：`raw material/61国新能源基础信息与政策索引_20260828.xlsx`，同时在本批 `outputs` 保留同哈希交付副本。
- 新增原始资料：`raw material/countries/ZMB`。
- 扩展全局索引：`raw material/global_sources/61_*.csv`、`collection_integrated_61.json` 与根目录 `collection_manifest_61.json`。
- 新增国工程候选：`runtime/country-extensions/zmb-20260828-r1`。
- 双语概述及研究映射：`runtime/market-overview/zmb-20260828-r1`；冻结审核候选在 `runtime/market-overview/zmb-review-20260828-r1`。

以下说明对应资料收集交付时点：当时尚未批准、发布、导入数据库、提交或推送Git，也未部署腾讯云。
该阶段既有种子、历史审核包、59篇已发布概述、原60国原件及工作簿不变。
后续发布引用用户确认的同一份最终Excel及其文件哈希，没有新增分国签署或D1—D4分轮会议。
确认后的发布使用独立的扩展种子合同与导入校验；不得把扩展候选交给旧固定60国导入器。

## 内容与口径

赞比亚包含1条国家档案、2020—2024五条宏观年度记录、1条能源记录。
拆分为38个有值观测和1个保留空白的用电需求；用电需求本期不展示，不用发电量替代。
2020年GDP实际增长率和2022年FDI净流入的负值保留。

装机来自IRENA 2026 H1中的2025年统计；发电来自IRENA 2025 H2中的2023年统计。
总量与可再生分量按同期匹配后计算占比，不从可再生总量反推光伏、风电或储能规模。
ERB行业报告与IRENA存在口径差异，内部底稿保留差异，不默默覆盖图表数据。
人口为WDI 2025年值，陆地面积为2023年值；不同指标不统一标成采集年份。
业务区域采用Southern Africa，另保留其与UN M49统计区域Eastern Africa的口径区别。

9个政策主管机关/官方入口、15条政策记录、7个专题；实际归档9份政策文件及8份官方支撑材料。
URL-only、403限制和下载失败如实保留，不以公告或年度报告冒充缺失的法规全文。
原文、请求信息和SHA-256保留在ZMB目录；原始材料不放进Git或公开静态目录。

市场概述由研究事实重新撰写，中文1845个去空白字符、7个自然段，英文同段忠实翻译。
10个商业事实锚点、22条带页码/条款的依据及明确缺口单独保留，不进入对客正文。
脚本只做收集、规范化、绑定、版本和制表，不拼装通用段落，不自动生成新判断。

## 原始资料重放

在WSL仓库根目录执行。当前环境没有 `uv` 命令，下面直接使用仓库现有的锁定虚拟环境。

```sh
.venv/bin/python scripts/country_expansion/collect_zmb_basic.py --stage verify
.venv/bin/python scripts/country_expansion/build_raw_expansion.py verify \
  --baseline runtime/country-expansion/zmb-20260828-r1/legacy-hashes.json

.venv/bin/navigator-data validate-country-extension \
  --candidate-dir runtime/country-extensions/zmb-20260828-r1 \
  --workbook "outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx"

.venv/bin/python scripts/market_research/verify_review_workbook.py \
  runtime/market-overview/zmb-review-20260828-r1/review-data.json \
  "outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx" \
  --extension-review runtime/country-extensions/zmb-20260828-r1/review-data.json
```

原始文件基线 `legacy-hashes.json` 冻结了1047个原资料、旧种子及已发布内容文件。
`build_raw_expansion.py build` 只创建尚不存在的扩展索引，拒绝覆盖。
本轮调试的生成中间稿另存于本批runtime目录；它们不是审核表或发布版本。

新增概述必须显式指定扩展范围，默认旧59国范围保持不变：

```sh
.venv/bin/python scripts/market_research/assemble_content.py \
  --authored-dir runtime/market-overview/zmb-20260828-r1 \
  --output runtime/market-overview/NEW-REVIEW-REVISION \
  --package-id OVERVIEW-ZMB-20260828-R1 --countries ZMB \
  --expected-scope-count 60 \
  --profiles "raw material/global_sources/61_country_profiles.csv"
```

以上示例中的新目录必须由操作者明确命名。不得覆盖本次已经冻结的候选，后续更新应使用新内容版本。

## Excel结构与验证

审核表中的“中文阅读”和“基础数据阅读”为只读公式视图，分别引用唯一的“内容编辑”F列和“新增国内容”F列。
基础数据阅读包括14条档案字段及39条观测，中文标签、统计期、单位和原始编辑行号便于核对。
来源与研究缺口单独列出；空来源ID保持空白，不因公式引用变成数字0。

来源的 `captured_at` 在审核表内用规范JSON字符串封装，避免表格引擎自动转换日期而丢失时区和微秒。
检查器严格比较完整编码，不剥除任意字符、不回推日期、不放宽来源或哈希匹配。
原候选和原始证据始终保留真实ISO时间字符串。

工作簿只通过随应用提供的artifact工具编写；原索引导入后另存新副本，原件哈希不变。
导出后另外使用只读解析核验全部合同、公式缓存、旧区保留和源文件哈希，并检查实际渲染。
完整合并说明区域必须渲染 `A1:N19`；截取 `A1:J19` 会产生误导的重叠/竖排预览。
下载数量采用两类明确状态的COUNTIF之和；不使用当前引擎算错的通配符缓存。

当前Windows artifact运行时在完成导出及预览后出现原生退出异常 `-1073740791 / 0xC0000409`。
不能将其记作导出进程成功；最终是否可交付以实际XLSX的独立读取、内容、公式及视觉验证为准。
运行时异常与文件验证结果分别记录，本轮不修改用户Excel安装或系统设置。

## 质量检查

```sh
.venv/bin/ruff format --check .
.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest --cov
```

`tests/market_research` 已纳入默认测试发现范围。新增测试覆盖范围扩展、原文件保全、列顺序、非有限值、空值、负值、重复行和同Excel内容绑定。
提交前仍须执行根 `AGENTS.md` 规定的完整数据准备检查；收集阶段的候选验证不替代用户的发布确认。

资料收集阶段检查结果（2026-08-28，历史记录；发布阶段完整回归见页首链接）：

- Ruff格式检查：187个文件通过；Ruff静态检查通过；mypy检查70个源文件通过。
- 完整pytest：1073项通过、2项未配置外部artifact测试夹具而跳过，18条依赖弃用/SQLite资源警告；退出码0，用时1134.20秒。
- 总覆盖率86.16%，达到仓库85%要求。两个夹具测试的跳过不替代本批实际Excel的独立验证；最终两份文件已经分别通过合同、公式、哈希与视觉核验。
- 原全量索引保留39867个旧单元格、780个旧公式；856个新增单元格及62项机器检查通过。
- 全量测试结束后再次重放1047个原始文件哈希，无变化；原运行种子及发布内容保持不变。
- 当时的交付路径、文件SHA-256、测试结果和导出工具退出异常分别记录在 `runtime/country-expansion/zmb-20260828-r1/handoff.json`。该历史记录生成时尚未收到用户确认或执行发布，保留原件，不用于判断当前发布状态。
