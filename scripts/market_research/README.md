# 新能源国别概述：专家式改写、集中确认与接入

本目录服务现有 Navigator Demo 的单篇国别市场概览。不修改基础数据种子、数据库结构、原始资料、历史审核包或正式阶段状态；不运行在线模型、向量数据库、政策搜索或会员系统。

## 当前阶段与交付顺序

用户已认可 IDN、VNM、SAU、ZAF、BRA 五国样稿的文风、分析深度和判断力度，并要求五国及其余 54 国统一采用偏向新能源资深专家的专业分析语气。本批将五国修订为 R2，其余 54 国为 R1；五国原 R1 独立留档。逐国事实支点、交易机制和进入约束决定文章结构，不复用整段文字或以通用核实清单补足篇幅。最终集中审核文件覆盖 59 个海外国家，由用户对其实际内容作一次确认后才发布。文风认可不等于这批正文的发布确认，不新增逐国签字、分轮会议或系统许可判断。

**当前状态（2026-08-28）：本批最终 Excel 已获 kevin 明确回复“审核通过”，59 国中英文概述已发布到原 Demo。** 发布包为 `OVERVIEW-59-20260827-R1`，五国 R2、其余 54 国 R1，信息截至日期仍为 2026-08-27。访问入口为 `http://127.0.0.1:3000`；本次确认没有改变基础数据或正式 D1—D4/P0 状态。下方准备与历史验证记录保留原有时间语境，不将之前的“未发布”记录改写为提前获得批准。

每国是一篇连贯正文：标题、6–8 个自然段和简短适用说明。中文正文去除空白后为 1,500–2,000 个 Unicode 字符，标点、数字计入；英文与中文保持相同段落数和事实口径。正文不再包含摘要卡片、六项折叠分析、九格等级或独立长篇报告，也不以通用清单凑篇幅。

来源、事实锚点、适用条件和研究缺口留在私有研究记录中。正文需要保留必要的不确定性，不以没有查到限制推定没有限制。读取原文或 SHA-256 一致仅证明取得了相应内容或字节未变，不证明法规现行、事实完整或已完成项目适用性确认。来源与许可由人工决定，机器只检查合同和追溯结构。

## 文件位置与旧版隔离

| 位置 | 用途 |
| --- | --- |
| `raw material/` | 原始资料，只读 |
| `runtime/market-overview/samples-20260827-r1/countries/ISO3.json` | 逐国撰写的双语样稿，不是模板生成结果 |
| `runtime/market-overview/samples-20260827-r1/research/ISO3.json` | 与同国同版本样稿绑定的私有研究记录 |
| `runtime/market-overview/sample-bundle-20260827-r1/candidate/` | 编排后可校验的五国候选，不能当作已发布内容 |
| 同一 bundle 下的 `reading-zh-CN.md`、`reading-en.md` | 五国文风校准阅读稿 |
| `runtime/market-overview/full-59-20260827-r1/` | 本批五国 R2 与其余 54 国 R1 的双语逐国稿及私有研究记录 |
| `runtime/market-overview/review-59-20260827-r1/` | 全量编排候选、双语阅读稿、审核行清单与研究索引；不是发布卷 |
| `outputs/market-overview-59-20260827/` | 本批集中审核 Excel、双语连续阅读文件及制表核验结果；不对外静态提供 |
| 同一 bundle 下的 `review-data.json`、`research-index.json` | 未来 Excel 的行清单、事实与原文定位、核验范围和输入哈希；不进入公开响应 |
| 同一 bundle 下的 `content-quality.json` | 结构、篇幅、双语数字、重复段落与哈希检查；不是事实完成或发布证明 |
| `runtime/market-overview/review-import-59-20260828-r1/` | 本次审核表导入结果及不可变导入收据，不覆盖原候选 |
| `runtime/market-overview/confirmations/OVERVIEW-59-20260827-R1.20260828.json` | 与最终审核表及导入候选哈希绑定的实际用户确认 |
| `runtime/market-content/` | 独立受保护发布卷；2026-08-28 已发布本批 59 国双语概述，仅 API 只读挂载 |
| `runtime/market-research/`、`outputs/market-59-20260827/` 内旧稿和旧 XLSX | 历史档案，不作为新概览输入、自动转换来源或内容回退 |

新稿、编排输出和最终 Excel 均使用独立的新目录或文件名，不覆盖旧版。研究目录、审核 Excel 和发布卷不进入 Git，不放入 Web 的公开静态目录，不通过 HTTP 暴露。对客页面不显示来源、Basic、审核或内部版本标签；信息截至日期仍保留。

## 打包逐国正文：不生成正文、不批准、不发布

从仓库根目录执行准备命令。当前环境没有 `uv` 时使用项目已有的 `.venv`；无需安装新依赖。以下五国命令记录历史样稿的打包方式；已有目录不会被覆盖，重放必须使用另一个输出目录和包 ID。

```bash
.venv/bin/python scripts/market_research/assemble_content.py \
  --authored-dir runtime/market-overview/samples-20260827-r1 \
  --output runtime/market-overview/sample-bundle-20260827-r1 \
  --package-id OVERVIEW-SAMPLES-20260827-R1 \
  --countries IDN VNM SAU ZAF BRA
.venv/bin/navigator-data validate-market-content \
  --candidate-dir runtime/market-overview/sample-bundle-20260827-r1/candidate
```

`--expected-scope-count` 默认是 59，检查完整海外国家范围；这不代表自动生成 59 国，也不能为了五国样稿将范围改为 5。`--countries` 明确选择本次已有逐国稿的子集。编排器只读取 `countries/`、`research/` 中的逐国输入，以及只读国家范围和被引用原件；不读取旧版报告候选，不补通用模板，不调用 AI。

输入和输出必须位于 `runtime/market-overview/` 下的独立目录。已有输出会被拒绝；修订时使用新稿版本、新包 ID 和新输出目录，不删除历史来重跑。每国候选使用 `navigator.market-overview.v1`，版本为 `OVERVIEW-ISO3-YYYYMMDD-Rn`，`as_of` 不得晚于版本日期。编排器检查双语段落数、数字抄录、重复正文、公开文本中的内部信息、研究映射和输入前后哈希。通过检查仍不是内容批准。

本批全量编排使用 `--authored-dir runtime/market-overview/full-59-20260827-r1`、`--output runtime/market-overview/review-59-20260827-r1`、`--package-id OVERVIEW-59-20260827-R1`，并通过 `--countries` 明确传入只读国家档案中排除 CHN 的 59 个 ISO3。不能从“现有多少稿件”反推验收范围。完整范围通过时状态为 `authored_review_bundle_valid`，子集仍为 `authored_sample_bundle_valid`；两者均为 `published=false`。

## 最终 59 国 Excel：一次集中确认

只生成一份 59 国集中审核 Excel，不把修订五国另设发布批次。新的全量候选使用已适配 overview 的制表器；七个工作表仍为“审核导览、国别总览、中文阅读、内容编辑、来源依据、待确认事项、包信息”。国别总览显示标题、开篇、正文字符数、段落数、待确认项和修改行，不再显示等级或报告长度。制表器除七张工作表首部外，另渲染中部、末尾国家及最长英文自然段，用于发现长文截断；这不替代逐行文本与公式核验。

制表前通过 `load_workspace_dependencies` 定位配套 Node 与 `node_modules`。在独立临时工作目录中建立指向该已验证依赖目录的 `node_modules` 符号链接或 junction；`CODEX_BUNDLED_NODE_MODULES` 设置为工具返回的原始依赖目录。在该临时目录使用配套 Node，以绝对路径执行脚本，不向仓库或系统安装依赖。以下为替换绝对路径后的命令形式：

```text
"<bundled-node>" --max-old-space-size=6144 "<repo>/scripts/market_research/build_review_workbook.mjs" "<final-bundle>/review-data.json" "<new-final-review.xlsx>" "<new-workbook-qa-directory>"
```

制表器只接受新的 overview 行合同，拒绝覆盖已有 Excel。核对初始交付表时，从仓库根目录使用只读检验器：

```bash
.venv/bin/python scripts/market_research/verify_review_workbook.py \
  "<final-bundle>/review-data.json" "<new-final-review.xlsx>"
```

检验器保留对历史表的只读核验能力，不把旧表转换为新概览。不要仅凭文件存在、渲染日志或进程开始就认定生成成功；检查进程结果、结构、数值/文本、渲染和最终文件哈希。用户修改后的表由正式导入器检查允许的变更，不要求与初稿逐字相同。

### 编辑合同

“内容编辑”前六列保持：
`country_code, content_version, locale, json_pointer, original_value, edited_value`。

- A–E 列不变，只修改 F 列文本；保留每个原始行，不删除、重复或手工拼接指针，不写公式。阅读页使用行引用时仅筛选、不重新排序。
- 可编辑字段仅为 `/locales/{zh-CN|en}/title`、现有 `paragraphs/N` 和 `disclaimer`。没有等级、评分、风险数组、章节或核验日期编辑字段。
- 中文仍须满足 1,500–2,000 字符与 6–8 段，英文保持同段数。事实、数字和适用条件的中英文一致性由人工确认；结构检查不是翻译质量或法律事实认证。
- 变更国家、版本、`as_of` 或段落数量等结构时，另建新版本候选和新表，不能修改原值或元数据来绕过绑定。
- “包信息”仍使用 `key,value`，包含 `navigator.market-review.v1`、`package_id`、`candidate_sha256`、`country_count` 和真实 ISO `created_at`。
- 来源依据和待确认事项是私有审核辅助表；追溯保留在 `review-data.json`、`research-index.json`，不传入对客正文或 API。

## 发布、单国更新、撤回与回退

具体确认字段、导入/发布命令、只读卷及撤回/回退约束见 [部署操作文档的 Single country market overview](../../deploy/basic60/README.md#single-country-market-overview)。

流程为：已取得的五国文风反馈 → 五国专家语气修订与其余 54 国编写 → 全量新 Excel 编辑与一次实际确认 → 导入校验 → 发布同国同版本的双语概述。导入也可先作机器预检，但不因此获得发布许可。已有基础数据确认、旧报告确认、样稿反馈和自动测试均不能代替最终这份 Excel 的实际确认，不预填批准。

发布卷不读取候选或研究目录；后续单国修改采用新版本和同样的一次确认流程，其他国家保持不变。原子指针、文件哈希、单写者锁、不可变历史和撤回墓碑机制继续适用。已撤回版本不能被回退复活；旧 `MARKET-` 分析/报告不能作为 `OVERVIEW-` 的回退目标。修正须另建新版本，不删除历史或修改基础数据。

## 页面与验证边界

唯一内容接口为 `GET /api/v1/countries/{code}/market-overview?locale=zh-CN|en`，公开响应只有 `meta` 和 `data:{title,paragraphs,disclaimer}`。`meta` 含国家、内容版本、截至日期与语言；内部追溯不进入响应。已通过既有权限及国家可见性检查的旧 `market-analysis`、`market-report` 请求返回 `410 MARKET_CONTENT_RETIRED`，且不在 OpenAPI 中展示。

国家详情在档案之后、既有能源/宏观图表之前独立加载一篇 `#market-overview`。旧报告页面及批准版/私有路径别名跳回同国概览，保留语言与国家上下文。中国及无效国家不可访问，不恢复比较。概览缺失、未确认、撤回或失败时显示中性不可用与重试，八张原有图表不受概览加载阻塞。

未确认样稿只用于正文/契约/组件测试；测试夹具须明确是合成开发数据，不能写入发布卷或伪装为已发布内容。在线 Demo 在尚无已确认概览时只验收空状态、重试和原有图表，不以临时静态文件或测试路由展示样稿充当线上验收。

2026-08-27 前序接口与页面改造完成了前端 lint、类型检查、66 个文件共 729 项测试及生产构建；统一加载/失败文案后又执行了 103 项专项测试、lint、类型检查和构建。当时后端完整回归 821 项通过，覆盖率 86.01%；研究编排和只读提取测试 31 项通过。全仓 Ruff 格式/静态检查与 mypy 69 个源文件检查通过。这些是前序工程验收记录，不是本批 59 国内容或 Excel 已确认的证明。未提交代码，也未重新生成或激活冻结数据基线。

原 Demo 的 API/Web 已重建并健康启动，数据库未重建。实际浏览器检查了概述空状态、桌面/手机无横向溢出、英文切换、键盘重试、旧规范报告地址跳转及返回地图恢复 IDN 选择。在线 API 验证原国家详情仍为 200，未发布概述为 404 且无正文，两个旧接口为 410，OpenAPI 只列新概述接口。真实样稿全文和打印排版尚未做在线浏览器验收；待最终内容确认后再检查，不将候选或合成文本注入发布卷。

前序审核工具曾使用两组临时合成工作簿进行内容检查和新合同导入回放（有来源/无来源）。2026-08-27 本批已生成真实 59 国集中审核文件：五国样稿为 R2，其余 54 国为 R1，共 1,064 行双语可编辑内容、480 条内部依据和 453 个事实支点。中文正文为 1,505–1,815 个去空白字符，共 414 个自然段；跨国整段重复、24 字连续片段重复及数字一致性检查未发现问题。这些检查不是事实、判断或翻译正确性的自动认证。

本批真实 XLSX 的七张表、全部原值/初始编辑值、公式缓存、私有依据清单、候选哈希和只读导入回放均已核验；十处预览覆盖各表、中文中后段和最长英文段。五国原 R1 文件哈希保持不变。实际结果保存在 `outputs/market-overview-59-20260827/qa/verification-final.json`；本轮后端完整回归为 821 项通过、覆盖率 86.01%，研究工具测试为 79 项通过、2 项可选临时工作簿测试跳过（真实本批工作簿另行全量核验）。未发布、未生成批准，也未提交或推送。

配套 Windows artifact-tool 在保存最终 XLSX、十张预览和审计记录之后，仍出现原生退出异常 `-1073740791 / 0xC0000409`。实际产物检查通过不等于导出进程成功，该运行时问题尚未解决，详情记录在 `qa/authoring-runtime.json`。导出器也未保留冻结窗格，筛选表及标题正常；使用者可在 Excel/WPS 中自行冻结。待确认事项按底稿原文呈现，不把英文原文标作中文，不构成另一层对客内容。

## 2026-08-28 实际确认与发布记录

本次先以只读方式重新核对最终审核文件，再使用既有 `import-market-review` 和 `publish-market-content` 发布，不重新撰写、重译或改动用户已确认的正文。确认日期按实际消息保留到日，不编造签署时分。可核对的绑定为：

- 审核表 SHA-256：`0f9e8a30553e2cc93b9f939df6d315862d0982901b5edd5dd53b90d957a31988`。
- 导入候选 SHA-256：`e076512048f268e0568976bc1f6c8ec84bdec977dd6876aaa2fe8f048471ae2d`。
- 已激活清单 SHA-256：`bcc069794f116369d8a18b37d8ab756dd2bd9535e0344cca277e12f2363844e1`。

原 Demo 的三个既有容器恢复运行且健康，未新建站点、重建或清空数据库。真实 API 的 118 份语言版本全部与已审核正文及元信息逐项一致，保留禁止缓存响应；中国、未知与无效国家、无授权请求、已取消的旧接口与比较接口均按合同拒绝。发布卷只读挂入 API，不进入 Web 或公开静态目录。

浏览器实际检查印尼概述的桌面和手机阅读、中文/英文切换、滚动、八张原图表、返回首页恢复 IDN 选择、出海工具/合作伙伴国家上下文以及旧报告地址跳转，无横向溢出或页面控制台错误。215 项相关后端回归通过，0 失败、0 跳过；更新、撤回、回退和异常处理测试使用隔离临时存储，未操作在线内容。打印/PDF 实际输出本次未重验；中国页面被浏览器验收工具拦截，因此该边界以真实 API 和自动测试结果为准。

这是第一批已发布的新概述，当前没有更早的已发布概述版本可回退；五国原 R1 样稿与旧 `MARKET-` 报告均不是回退目标。后续人工更新沿用新版本、一份 Excel、一次实际确认，不删除历史。原审核文件、旧稿和此前的 QA 记录保持不变。本次未提交或推送代码，也未推进正式发布门禁。

## 2026-08-28 赞比亚范围扩展候选

新增国收集与候选说明见 [country_expansion/README.md](../country_expansion/README.md)。既有59篇及已激活指针不变，本次不发布。

编排器新增可选 `--profiles`：显式读取原始资料内的新版国家范围CSV；默认仍读取原60国档案并排除中国，得到原59国。赞比亚包须传 `--profiles "raw material/global_sources/61_country_profiles.csv" --expected-scope-count 60 --countries ZMB`，不能仅修改默认数量掩盖范围变化。

赞比亚单篇中文1845字、7段，同版英文；10条商业事实锚点、22条依据及资料缺口独立绑定。制表器可用第四个参数接受新增国 `review-data.json`，在同一物理Excel中加入基础数据、来源和中文只读阅读页；没有第二份可编辑概述。

标准只读验证器使用 `--extension-review <新增国review-data.json>` 核验已知扩展表、字面字段和阅读公式，不允许任意新增表或绕过原七表检查。ISO采集时刻在来源表中采用严格JSON字符串编码以保留时区和微秒，原研究JSON中的时间和哈希保持不变。
