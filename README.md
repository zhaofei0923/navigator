# 新能源企业出海导航仪

本仓库以 `doc/doc` 下已审核的 V1.0-BASELINE 为唯一开发基线。当前执行阶段是
D0 数据标准冻结；D4 数据就绪评审正式通过之前，只建设数据准备、采集、质量和验收
工具，不启动 V0.1 用户侧产品功能。

## 当前可运行能力

- 从 D0 执行台账和技术附件中只读提取实体、字段、枚举、规则、国家范围与任务；
- 校验工作簿结构、唯一编号、任务依赖和冻结基线哈希；
- 生成可版本化的数据合同快照；
- 输出 D0 就绪报告，并对缺少签署、任务、验收和证据给出明确阻断原因；
- 校验验收证据文件的哈希和关联关系；
- 生成并校验AC-001/002的29个主键合同和92个字段单位/不适用逐项整改提案；
- 为AC-001/002生成与当前基线和整改模板哈希绑定的保守机器建议；建议文件不含签署
  字段，数值和复合字段保持人工分析边界；
- 将AC-001/002的29项主键和92项单位决定生成可直接阅读、带回复格式的Markdown
  审核工作表，并用建议JSON哈希防止错配；
- 将三份金标准候选的官方URL、日期、文件哈希、许可观察和四项必选结论生成事实型
  审核工作表，不保存或转载原件正文；
- 对独立候选D0工作簿执行整改包精确应用、全单元格越权差异和AC-001/002重算验证；
- 从已完成整改包原子生成独立候选D0工作簿；禁止覆盖、禁止写入权威`doc`目录，
  生成后验证不通过则不发布候选文件；
- 生成并校验 D1 来源准入、哈希证据、D2 不可变采集和 D3 可重放处理候选合同；
- 只读提取103项需求、166个页面、70个API、29条角色权限、109个产品/工程测试和
  11项MVP验收，并生成P0需求追踪预检矩阵；
- 对独立的候选技术附件执行提案一致性、越权差异和P0追踪归零验证，不修改或激活
  权威工作簿；
- 从已完成P0追踪整改包原子生成独立候选技术附件；禁止覆盖、禁止写入权威`doc`
  目录，自动验证失败时不发布候选文件；
- 生成并校验P0实现、测试、ACC验收、发布指标及构建/部署/回滚/恢复/移交证据包，
  校验时重放完整D4上游链。

## 本地运行

要求 Python 3.13。推荐使用 `uv`：

```bash
uv sync --dev
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run navigator-data validate
uv run navigator-data snapshot
uv run navigator-data prepare-d0
uv run navigator-data assess-d0
uv run navigator-data prepare-d0-review
uv run navigator-data validate-d0-contract-resolution \
  --input data/d0/candidates/core_contract_resolution.review.json
uv run navigator-data prepare-d0-baseline-change \
  --resolution data/d0/candidates/core_contract_resolution.review.json \
  --output /safe/path/d0-candidate.xlsx \
  --assessment-output /safe/path/d0-generation-assessment.json
uv run navigator-data validate-d0-baseline-change \
  --resolution data/d0/candidates/core_contract_resolution.review.json \
  --workbook /path/to/d0-candidate.xlsx \
  --output /path/to/d0-change-assessment.json
uv run navigator-data prepare-d0-baseline-review \
  --review data/d0/review/d0_review_packet.2026-08-02.json \
  --resolution data/d0/review/core_contract_resolution.2026-08-01.json \
  --workbook data/d0/candidates/d0_core_contract_candidate.2026-08-01.xlsx \
  --bundle-output data/d0/candidates/d0_baseline_adoption_review_bundle.2026-08-02.json \
  --confirmation-output data/d0/review/d0_baseline_adoption_confirmation.template.2026-08-02.json
uv run navigator-data prepare-d1
uv run navigator-data prepare-d2
uv run navigator-data prepare-d3
uv run navigator-data prepare-d4
uv run navigator-data prepare-p0-traceability
uv run navigator-data assess-p0-traceability
uv run navigator-data prepare-p0-resolution
uv run navigator-data prepare-p0-baseline-change \
  --resolution data/p0/review/p0_traceability_resolution.<date>.json \
  --output /safe/path/technical-candidate.xlsx \
  --assessment-output /safe/path/p0-generation-assessment.json
uv run navigator-data validate-p0-baseline-change \
  --resolution data/p0/review/p0_traceability_resolution.<date>.json \
  --workbook /safe/path/technical-candidate.xlsx \
  --output /safe/path/p0-change-assessment.json
uv run navigator-data prepare-p0-delivery
uv run navigator-data report
uv run pytest --cov
```

`validate` 只检查冻结基线结构，可用于持续集成。正式阶段门使用：

```bash
uv run navigator-data gate --stage D0
```

当前D0任务已完成4/4，D0-AC-001至008已批准；但权威工作簿仍未采用已验证候选，
且D0-AC-009/010尚未批准，因此该命令仍应返回非零状态。

GitHub Actions会在每次`main`推送和Pull Request上执行同一套校验：锁定依赖、格式、
静态检查、类型检查、冻结基线、合同快照、D0—D4及P0全部候选生成和测试覆盖率。
工作流在运行生成器前后核对两个源Excel的SHA-256，并拒绝任何合同或候选文件漂移。
合同清单还保存每个生成JSON文件的SHA-256，因此解析逻辑改变但行数未变也会被发现。

`prepare-d0`生成的候选验收包位于
[`data/d0/candidates`](data/d0/candidates/README.md)。印尼 ESDM、越南 EVN 和沙特
Principal Buyer 三份公开原件均已完成来源、日期、文件哈希、PDF安全属性和视觉
核验；对应官网版权/引用提示也已保存为事实型许可观察快照，原件不入库。三份样本
均已由授权角色确认`limited / false / false / approved`。
`prepare-d0`生成的`raw_sample_review_worksheet.md`已把三份样本的核验事实和允许选择
集中排版；它不构成法律意见，正式结论仍须绑定合规与专业证据。

当前正式评审副本已记录9个角色、6项字段映射、3份候选规范和D0-AC-001至008的书面批准。
`report`和`gate`会在校验基线哈希与证据引用后应用这部分进度，因此不再把已签角色
误报为未签，也会按已批准映射执行模板目标试填；D0-AC-009/010和最终D0结论仍保持
阻断。schema v3把映射决策人、合规/专业复核人、候选规范复核人、
每项验收签署人和最终批准人逐项绑定到九角色清单中的实名责任人；本人不能担任自己
的替补或升级人，日期必须是ISO日期或带时区时间，单独填写角色名不再构成批准。
每个证据编号还必须在清单中对应正确的D0验收项、同一实名复核人和已批准状态；样本
合规结论与专业结论使用独立证据列表，不能拿其他验收项或其他人的证据代替。

D0合同深度审计进一步发现，原先对AC-001/002的简化机器检查不足以证明验收文本：
25条关系涉及34个实体代码，但只有5个实体在字段合同中显式标记主键；92个字段虽有
唯一编号、类型、必填和来源规则，却没有独立的单位代码或“不适用”元数据。因此
权威工作簿上的AC-001和AC-002机器状态仍为`fail`，不得仅靠人工签名覆盖。AC-003的
251条枚举与13条迁移记录结构检查通过，相关验收现已完成实名复核。三份候选机器
证据及其SHA-256待审队列由`prepare-d0`确定性生成，机器通过不等于基线采用。
同一命令还生成`core_contract_resolution.template.json`，固定全部29个主键缺口和
92个字段单位决策，并生成`core_contract_recommendations.json`降低逐项分析成本：
29个缺口统一建议新增UUID代理主键，69个明显非度量字段建议单位不适用，3个数值字段
和20个复合字段明确保留给人工分析。该建议文件不含签署字段且全部标记必须人工决策，
不能直接作为整改副本或批准证据；同一命令生成的`core_contract_review_worksheet.md`
按四类决定排版并附可复制回复格式。整改副本必须绑定当前工作簿与机器证据哈希、Kevin所签九角色中的
指定实名、ISO时间、变更单和证据；`validate-d0-contract-resolution`通过只表示提案
可进入正式基线变更评审，不会改写冻结Excel、批准D0或授权用户侧开发。
在授权人员形成完整整改副本后，`validate-d0-baseline-change`可验证独立候选D0
工作簿是否精确应用全部决定。它保持原字段顺序，只允许追加已评审主键字段和`单位`
列，逐单元格拒绝其他值或公式改动，并重算AC-001/002。验证成功仍不替换权威文件。
`prepare-d0-baseline-change`可直接从完成的整改副本生成该候选文件，并在原子发布前
运行同一验证器；输出已存在、位于`doc`目录、扩展名错误或验证失败时均不会写出候选。
当前独立候选已经通过AC-001/002复算并完成对应验收。`prepare-d0-baseline-review`
进一步重放最新正式评审、整改包和候选验证，将权威源、候选、决策、签署及变更规模
绑定为项目批准人审核包和待填确认模板。该包仍不修改或激活权威工作簿；批准后必须由
基线责任流程另行发布正式修订版，再重新生成合同并复算D0门禁。

正式责任人可按
[`data/d0/review`](data/d0/review/README.md)中的流程复制评审模板，填写角色、映射、
样本、候选规范和D0-AC-001至010的实际决策，再用 `validate-d0-review` 做提交前检查。
该检查验证完整性、基线一致性和实名授权绑定，但不能代替授权人员作出决策。

D1候选包位于
[`data/d1/candidates`](data/d1/candidates/README.md)。它固化印尼20个、四个比较国
各8个active来源门槛，并要求五国40个“国家×核心数据域”组合分别绑定不同的优先
来源和替代来源。当前已登记18个冻结起始来源和41个官方研究候选，五国候选数量
达到目标，但59个候选全部保持`under_review`，active数量仍为0。D0未通过、许可或
访问边界未决，或证据编号未关联仓库内真实文件及匹配SHA-256时，`validate-d1`
必须失败。

D2候选包位于
[`data/d2/candidates`](data/d2/candidates/README.md)。它将6个冻结批次固化为采集任务，
要求每次运行保存幂等、水位和请求响应证据，每个L0对象保存不可变原件元数据和
SHA-256，并对403、验证码、付费墙、许可、robots和schema漂移执行停止而非绕过。

D3候选包位于
[`data/d3/candidates`](data/d3/candidates/README.md)。它固化
`D3-PARSE`、`D3-STANDARDIZE`和`D3-ENTITY`三段可重放流水线，要求逐条保存
L0来源、原文与译文、原值与标准值、转换规则、运行清单、实体决策、冲突证据和
可撤销合并历史。所有D3输出仍是候选数据，不得发布或进入AI索引。

D4候选包位于
[`data/d4/candidates`](data/d4/candidates/README.md)。它把五国最低样本、七维
100分评分、双人抽样、追溯/许可/准确率/重复率/P0硬门、种子导入与重建、回滚、
来源撤权、RAG权限、九项移交物和项目委员会签署做成一套可复算合同。只有真实完成
并通过`validate-d4`的评审副本，才可能作为进入V0.1的证据。D4校验会独立重算当前
P0需求、页面、API、权限和测试追踪报告并冻结其哈希，不能用候选包自报“P0问题为0”
绕过尚未关闭的追踪缺口。

P0追踪预检候选包位于
[`data/p0/candidates`](data/p0/candidates/README.md)。技术附件中的90项P0需求、
125个P0页面、56个P0 API合同、89个P0产品测试、17个P0工程验收用例和11项MVP验收
已进入机器合同。当前仅63项P0需求关联P0测试，且17个P0页面需求映射、93个API映射、
76个测试映射仍待补充或细化；页面权限代码与`PERM-*`编号也缺少直接映射列。因此
105种页面权限代码均保持未映射硬阻断，追踪预检和交付预检均未通过；工具不会把
“文档已确认”解释为已实现或已验收。
整改模板已把27个需求测试缺口、98个页面映射整改项和105种权限代码逐项列出；
`validate-p0-resolution`校验提案的冻结哈希、稳定编号、变更请求和复核元数据，
并要求每个新增需求、API、测试或权限编号同时附带完整合同记录；不会自动应用或批准
任何基线变更。提案填写完成后，可用`prepare-p0-baseline-change`原子生成独立候选
技术附件，或用`validate-p0-baseline-change`检查独立制作的候选。两者都核对所有
单元格和公式，只允许评审包声明的合同、页面和权限映射变更。新增合同记录会逐字段
匹配评审包的完整行定义，而不是只核对编号和必填字段；随后在候选附件上重算P0追踪
阻断是否归零。生成器拒绝覆盖现有文件或写入`doc`，验证失败或异常不会发布候选。
通过仍只表示候选附件可以进入正式基线评审，D4继续使用`doc/doc`中的权威附件。

P0交付证据模板进一步逐项冻结90项需求、125个页面、56个API、89项产品测试、
17项工程测试和ACC-001至ACC-011，并固化缺陷、关键任务、泄漏、AI引用、性能、
容量、RPO/RTO、构建、部署、回滚、恢复和移交硬门。schema v8要求关键任务成功率
和AI引用覆盖率由整数分子/正分母复算，六类泄漏均须为0且各有正数测试样本；第35章
的18项性能、容量及灾备指标分别冻结比较方向、阈值、单位和需求编号，并逐项绑定
观测值与证据，不能用汇总自报状态代替。构建、部署、回滚、恢复和
移交分别记录最终提交、执行人与时间、授权复核人与时间及证据，不能用五个自报状态
替代实际演练。发布制品还必须记录来源提交、不可变SHA-256、包含该哈希的内容寻址
位置、生产人/时间和证据；指标、五项发布能力及最终批准必须在制品生成后绑定同一个
哈希，不能从同一提交重新构建另一份制品替换已测试版本。`validate-p0-delivery`必须重放
完整D4→D3→D2→D1→D0链，要求完成包已提交到`data/p0/delivery`并逐字节匹配当前
`HEAD`中的同路径Git blob，同时验证Git提交存在性、最终发布祖先关系以及仓库内
非限制性证据的当前文件和声明提交Git blob双重哈希。测试复核人、ACC验收人和证据
批准人必须位于D4项目委员会批准的签署授权清单，最终发布只能由同一D4项目委员会
签署人批准；每份证据还必须用稳定`subject_refs`反向声明其覆盖事项，并与事项中的
`evidence_ids`双向一致，且只能使用`data/p0/evidence`内规范的仓库相对路径。发布
指标必须记录测量人和时间，并绑定最终发布的精确Git提交，不能沿用旧提交的测试结果。
仓库外临时包、未提交工作区副本、任意姓名、自报状态、游离提交、未知主题、
路径别名或未被引用的证据都不能构成P0完成结论。

完整实施顺序见
[`docs/development/P0_IMPLEMENTATION_PLAN.md`](docs/development/P0_IMPLEMENTATION_PLAN.md)。
