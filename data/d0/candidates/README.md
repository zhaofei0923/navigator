# D0候选验收包

本目录由 `navigator-data prepare-d0` 从已审核工作簿和冻结正文生成。所有文件均为
机器检查或待审核候选，不是批准记录，也不得直接改变D0台账状态。

| 文件 | 用途 | 当前边界 |
|---|---|---|
| `acceptance_assessment.json` | D0-AC-001至010逐项机器评估 | `human_status`全部保持`pending` |
| `conventions.json` | 单位、货币、时区、精度和多语言规则候选 | 待产品、数据和语言审校批准 |
| `file_rules.json` | 原始资料目录、命名和清单字段候选 | 待数据和合规负责人批准 |
| `template_trial_report.json` | 批次、来源、原始资料和字段映射交叉试填 | 6条映射目标不存在，当前失败 |
| `gold_standard_gap_report.json` | 金标准示例缺口 | 印尼与越南样例已核验原件元数据；许可、专业复核及沙特原件仍待完成 |
| `mapping_resolution_proposal.json` | 6条未知映射的候选处理 | 仅ISO代码存在高置信直接目标，其余需领域决策 |
| `terminology_review_queue.json` | 45组、251条枚举术语复核队列 | 待专业语言和业务复核 |

处理原则：

1. 先由数据负责人决定6条映射应更正目标还是补充冻结字段；
2. 正式变更必须同步更新Markdown、技术附件、D0台账和版本记录；
3. 真实金标准必须补齐原件哈希、发布日期、采集时间、许可快照和专业复核；
4. 审批证据登记到 `data/d0/evidence/manifest.json`，不得直接编辑机器结论伪造通过；
5. 更新正式基线后重新运行 `snapshot`、`prepare-d0`、`validate`和`gate --stage D0`。

`data/d0/research`可以保存公开来源的元数据和哈希。原件、受限内容和许可未明确的
文件不进入Git；研究记录也不能代替来源准入和专业复核。
