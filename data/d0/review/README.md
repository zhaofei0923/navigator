# D0正式评审包

本目录把D0剩余决策、责任签署、样本合规/专业复核和10项硬门集中到一个可机检的
评审包。模板由冻结工作簿和 `data/d0/candidates` 候选结论生成，不代表任何人已批准。

## 使用顺序

1. 先刷新候选和模板：

   ```bash
   uv run navigator-data prepare-d0
   uv run navigator-data prepare-d0-review
   ```

   若先整改AC-001/002，复制候选目录中的核心合同整改模板，填写完121个逐项决定后
   执行：

   ```bash
   uv run navigator-data validate-d0-contract-resolution \
     --input data/d0/candidates/core_contract_resolution.review.json
   ```

   该命令通过后，用下列命令在权威Excel之外原子生成并验证候选D0工作簿：

   ```bash
   uv run navigator-data prepare-d0-baseline-change \
     --resolution data/d0/candidates/core_contract_resolution.review.json \
     --output /safe/path/d0-candidate.xlsx \
     --assessment-output /safe/path/d0-generation-assessment.json

   uv run navigator-data validate-d0-baseline-change \
     --resolution data/d0/candidates/core_contract_resolution.review.json \
     --workbook /safe/path/d0-candidate.xlsx \
     --output /safe/path/d0-change-assessment.json
   ```

   生成器拒绝覆盖现有文件或写入权威`doc`目录，并在验证失败时清理临时文件。以上
   命令通过都只说明提案和候选工作簿可进入正式基线变更评审，不会更新本评审包的
   机器状态，也不会替换权威Excel。

   当最新正式评审已经批准AC-001/002且候选验证通过后，生成项目批准人审核的基线
   采用交接包：

   ```bash
   uv run navigator-data prepare-d0-baseline-review \
     --review data/d0/review/d0_review_packet.2026-08-02.json \
     --resolution data/d0/review/core_contract_resolution.2026-08-01.json \
     --workbook data/d0/candidates/d0_core_contract_candidate.2026-08-01.xlsx \
     --bundle-output data/d0/candidates/d0_baseline_adoption_review_bundle.2026-08-02.json \
     --confirmation-output data/d0/review/d0_baseline_adoption_confirmation.template.2026-08-02.json
   ```

   交接包会绑定权威工作簿、独立候选、完整整改包、最新正式评审和AC-001/002签署，
   并重新执行候选机器验证。项目批准人只能对精确包哈希选择
   `approved_for_manual_adoption`或`rejected`。即使批准，工具也不会修改或激活权威
   Excel；仍须由正式基线责任流程另行发布修订版，之后重建合同并复算D0门禁。

   项目批准人完成精确哈希确认后，将授权原文整理为`data/d0/evidence`下的结构化确认
   文件，再执行：

   ```bash
   uv run navigator-data apply-d0-baseline-decision \
     --input data/d0/evidence/kevin_baseline_adoption_confirmation_<date>.json \
     --bundle data/d0/candidates/d0_baseline_adoption_review_bundle.<date>.json \
     --decision-output data/d0/review/d0_baseline_adoption_decision.<date>.json \
     --manifest-output data/d0/evidence/manifest.json
   ```

   应用命令会重新生成并比对审核包、核对项目批准人和ISO日期，原子发布决定记录和
   证据清单，并为AC-001/002生成两个不同证据编号。它拒绝模板、未授权转录、普通
   `approved`、回溯日期、错误清单位置和任何覆盖；`approved_for_manual_adoption`仅
   授权后续人工基线流程，不会在本命令中改写权威文件。

   决定写入且为`approved_for_manual_adoption`后，基线责任人应先把已批准候选复制到
   `doc`目录之外的安全暂存位置，并使用权威工作簿的原文件名，再执行只读交接复核：

   ```bash
   uv run navigator-data validate-d0-baseline-publication \
     --decision data/d0/review/d0_baseline_adoption_decision.<date>.json \
     --workbook /safe/staging/新能源企业出海导航仪_D0数据标准冻结执行台账.xlsx \
     --output data/d0/candidates/d0_baseline_publication_readiness.<date>.json
   ```

   该命令会重放决定与AC-001/002证据、复算整改包并核对暂存副本的精确哈希；它只生成
   就绪报告，不会发布、替换或激活权威工作簿。正式发布仍必须由人工基线责任流程完成，
   随后重建合同并运行完整D0门禁。

2. 复制模板，文件名必须明确包含实际评审批次，例如：

   ```bash
   cp data/d0/review/d0_review_packet.template.json \
     data/d0/review/d0_review_packet.2026-08-01.json
   ```

3. 由实际责任人填写副本，不要编辑模板。必须完成：

   - 9个角色的实名责任人、替补、升级人、签署时间和签署证据编号；责任人不能同时
     作为自己的替补或升级人；
   - 6条字段映射的最终处理、目标、理由、变更单、冻结决策角色、实名决策人和证据编号；
   - 3条金标准样本的原件、许可快照、再分发/AI边界和专业复核；
   - 3份候选规范中每个指定角色的`reviewer_signatures`实名签署；
   - D0-AC-001至D0-AC-010中每个指定角色的实名签署、时间和证据编号；
   - 冻结`项目批准人`角色及其实名责任人的D0最终结论。

   许可终态只能是`approved`、`limited`或`rejected`；专业复核终态只能是
   `approved`或`rejected`。许可拒绝时再分发与AI索引必须同时为`false`，拒绝结论
   同样必须由实名合规负责人签署，不能用“拒绝”绕过审计字段。样本分别使用
   `compliance_evidence_ids`和`professional_evidence_ids`，以区分合规与专业签署。

4. 校验评审副本：

   ```bash
   uv run navigator-data validate-d0-review \
     --input data/d0/review/d0_review_packet.2026-08-01.json
   ```

5. 将证据登记到 `data/d0/evidence/manifest.json`，通过正式评审副本或版本化变更
   覆盖层记录批准结论，再重新运行 `snapshot`、`prepare-d0`、`validate`和
   `gate --stage D0`。源工作簿始终保持只读。

## 部分评审进度

`report`和`gate`会读取本目录中按文件名排序的最新
`d0_review_packet.<批次>.json`。只有基线与候选哈希匹配、证据编号可解析且对应条目
自身通过结构与实名授权检查的角色、映射和验收决定才会计入进度。schema v3要求
映射、样本、候选规范、验收和最终批准的姓名等于对应已签角色的责任人，并要求
ISO日期或带时区的ISO时间；只填角色标签、冒用其他姓名或无时区时间都会失败。
每个已引用证据还必须在`data/d0/evidence/manifest.json`中绑定该决定对应的验收编号、
同一复核人和批准状态；重复编号、跨验收挪用或其他人的证据都会失败。
部分评审包可以减少已完成
事项的误报，但任何待审样本、缺失验收或最终结论仍会阻断D0。

若同目录存在多个正式副本，工具会给出提醒并使用文件名排序后的最新副本；归档旧
副本前应确认其证据仍可追溯。

## 安全与审计边界

- 不得由开发代理、脚本或机器检查代替责任人签署；
- 不得在评审包中填写电话、私人邮箱、身份证件、密钥或其他非必要个人信息；
- 所有证据编号必须对应到证据清单中的正确验收项、复核人和已批准状态，证据文件需
  经过再分发和隐私审查；
- 模板中的基线哈希必须与当前冻结工作簿一致；不一致时重新生成，禁止复制旧批准；
- 来源被拒绝时必须更换样本，不得把“已作决定”误报为“已获准使用”。
