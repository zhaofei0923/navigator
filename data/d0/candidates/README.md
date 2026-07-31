# D0候选验收包

本目录由 `navigator-data prepare-d0` 从已审核工作簿和冻结正文生成。所有文件均为
机器检查或待审核候选，不是批准记录，也不得直接改变D0台账状态。

| 文件 | 用途 | 当前边界 |
|---|---|---|
| `acceptance_assessment.json` | D0-AC-001至010逐项机器评估 | `human_status`全部保持`pending` |
| `core_entity_evidence.json` | AC-001实体代码、主键、关系与权威记录证据 | 34个关系实体中29个缺显式主键合同，机器失败 |
| `core_field_evidence.json` | AC-002字段代码、类型、单位、空值和来源证据 | 92个字段缺独立单位/不适用元数据，机器失败 |
| `core_contract_resolution.template.json` | AC-001/002逐项整改提案模板 | 固定29个主键决策和92个单位/不适用决策；通过仅表示可进入基线变更评审 |
| `core_contract_recommendations.json` | AC-001/002保守机器建议 | 29个UUID代理主键建议；69个字段建议单位不适用，3个数值字段和20个复合合同留待人工分析 |
| `enum_migration_evidence.json` | AC-003枚举互斥与迁移记录证据 | 251条枚举和13条迁移结构通过，语义待人工复核 |
| `machine_evidence_review_queue.json` | 三份机器证据的路径、哈希与待审登记模板 | 失败项不得批准，模板不得直接复制成已批准证据 |
| `conventions.json` | 单位、货币、时区、精度和多语言规则候选 | 待产品、数据和语言审校批准 |
| `file_rules.json` | 原始资料目录、命名和清单字段候选 | 待数据和合规负责人批准 |
| `template_trial_report.json` | 批次、来源、原始资料和字段映射交叉试填 | 6条映射目标不存在，当前失败 |
| `gold_standard_gap_report.json` | 金标准示例缺口 | 三份原件元数据与许可观察快照已核验；许可结论和专业复核待完成 |
| `mapping_resolution_proposal.json` | 6条未知映射的候选处理 | 仅ISO代码存在高置信直接目标，其余需领域决策 |
| `terminology_review_queue.json` | 45组、251条枚举术语复核队列 | 待专业语言和业务复核 |

处理原则：

1. 6条映射已有正式决定；基线变更仍须按批准目标更新字段/实体合同和版本记录；
2. 先审阅`core_contract_recommendations.json`；它不含签署字段，所有建议均要求人工
   决策，不得把它改名或补签后当作整改副本；它不属于正式D0评审输入哈希，算法更新
   不会追溯性废止既有签署，建议文件自身则绑定当前整改模板哈希；
3. 复制`core_contract_resolution.template.json`，逐项填写实名提案人与复核人、变更单、
   时间和证据，再运行`validate-d0-contract-resolution --input <副本>`；不得删减项目；
4. 校验通过后运行`prepare-d0-baseline-change --resolution <整改副本> --output
   <新候选.xlsx>`原子生成独立候选；输出不得位于`doc`目录或覆盖现有文件，生成后
   验证不通过不会发布；也可对独立制作的候选运行`validate-d0-baseline-change`；
   两者都要求原字段顺序不变，只追加已评审主键字段和`单位`列，拒绝其他单元格或
   公式改动；
5. 候选工作簿验证通过仍须接受正式变更评审，不会替换或批准权威基线；
6. 正式变更必须同步更新Markdown、技术附件、D0台账和版本记录；
7. 真实金标准必须由合规和专业负责人补齐最终结论及各自证据；
8. 机器状态为`fail`时不得批准；`pass`也只表示可进入实名人工复核；
9. 审批证据登记到 `data/d0/evidence/manifest.json`，不得直接编辑机器结论伪造通过；
10. 更新正式基线后重新运行 `snapshot`、`prepare-d0`、`validate`和`gate --stage D0`。

`data/d0/research`可以保存公开来源的元数据和哈希。原件、受限内容和许可未明确的
文件不进入Git；研究记录也不能代替来源准入和专业复核。
