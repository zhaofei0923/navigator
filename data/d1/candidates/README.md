# D1来源准入候选包

本目录由 `navigator-data prepare-d1` 从冻结来源清单、五国范围、数据域目标和
[`../research/official_source_candidates.json`](../research/official_source_candidates.json)
生成。18个冻结起始来源和41个官方研究候选共59个，全部为 `under_review`，不是已
准入来源。D0正式门禁未通过时，不得把任何来源改为 `active` 或用于自动批量采集。

| 文件 | 用途 | 当前结论 |
|---|---|---|
| `source_admission_registry.template.json` | 来源主数据、许可、访问和用途边界模板 | 59个候选均待数据/合规复核 |
| `d1_evidence_manifest.template.json` | 来源与数据域批准证据、文件路径和SHA-256清单 | 59个来源和40个组合均待真实证据 |
| `domain_source_matrix.template.json` | 五国核心数据域的优先与替代来源 | 40个组合均待绑定 |
| `source_coverage_gap_report.json` | 印尼20个、比较国各8个来源目标差距 | 候选数量已补齐，active数量仍为0 |
| `d1_acceptance_assessment.json` | D1机器评估摘要 | D0依赖、active来源、替代源和合规仍未通过 |

研究目录仅记录官方候选入口和初步用途。它不包含条款、许可、robots或访问限制的
批准结论，也不允许自动采集、复制、再分发、展示、导出、AI索引或模型训练。

## 执行流程

1. 先完成D0正式签署和阶段门；
2. 复制三个 `.template.json`，将 `template_only` 改为 `false`；
3. 复核18个冻结起始来源和41个官方研究候选；如替换候选，保留变更理由和证据；
4. 对每个来源保存当日条款、许可、robots和访问规则快照；
5. 明确12类用途边界，以及登录、付费、验证码、地区和自动化限制；
6. 将来源身份、条款、许可、robots、访问评审、用途批准、试采和准入批准证据保存到
   [`../evidence`](../evidence/README.md)，并在证据清单中登记复核人、时间、相对路径
   和SHA-256；
7. 只有数据负责人和合规负责人批准、证据齐全、小样本验证成功后才可转`active`；
8. 为五国每个核心数据域绑定不同的active优先来源和替代来源，并登记批准证据；
9. 执行：

   ```bash
   uv run navigator-data validate-d1 \
     --registry data/d1/source_admission_registry.json \
     --matrix data/d1/domain_source_matrix.json \
     --evidence data/d1/d1_evidence_manifest.json
   ```

## 禁止事项

- 不得把“公开可访问”解释为允许批量复制、再分发、下载或AI索引；
- 不得绕过登录、验证码、付费墙、地区限制、robots、速率限制或技术封禁；
- 不得把`under_review`、`blocked`或`retired`来源用于自动采集；
- 不得只填写证据编号而不保存对应文件，或在证据文件变化后继续使用旧哈希；
- 不得用同一个来源同时充当某国家/数据域的优先源和替代源；
- 不得在许可撤回后继续采集、展示、导出或保留AI索引。
