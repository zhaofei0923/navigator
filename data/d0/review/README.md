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

   在人工发布前，把完整交接状态绑定到包含决定和就绪报告的批准Git提交：

   ```bash
   uv run navigator-data prepare-d0-baseline-publication-authorization \
     --approval-commit <commit-containing-decision-and-readiness> \
     --decision data/d0/review/d0_baseline_adoption_decision.<date>.json \
     --readiness data/d0/candidates/d0_baseline_publication_readiness.<date>.json \
     --workbook /safe/staging/新能源企业出海导航仪_D0数据标准冻结执行台账.xlsx \
     --output data/d0/candidates/d0_baseline_publication_authorization.<date>.json
   ```

   人工流程发布并将权威工作簿提交到该批准提交的后继Git提交后，执行：

   ```bash
   uv run navigator-data validate-d0-baseline-adoption \
     --authorization data/d0/candidates/d0_baseline_publication_authorization.<date>.json \
     --output data/d0/candidates/d0_baseline_adoption_assessment.<date>.json
   ```

   发布后验证器从批准提交读取旧权威文件及全部审核对象，因此不依赖被替换后的现场旧
   文件；它要求新权威文件哈希、Git对象和提交祖先关系同时正确。只替换工作区文件但未
   提交、采用未知哈希或游离提交都会失败。通过后才能重建合同并准备AC-009/010复核。

   重建合同和D0候选后，先生成采用后的评审迁移候选包：

   ```bash
   uv run navigator-data prepare-d0-post-adoption-review \
     --authorization data/d0/candidates/d0_baseline_publication_authorization.<date>.json \
     --output data/d0/candidates/d0_post_adoption_review_bundle.<date>.json
   ```

   该命令只从批准提交读取旧正式评审，并把已签角色、映射、样本、规范及AC-001至008
   与当前评审模板逐项比较。它要求AC-001/002/003当前机器证据通过，拒绝技术附件变化、
   静态输入变化、未提交发布和意外待审项；候选包内的拟迁移副本仍保持AC-009/010及最终
   D0决定为待审。候选包不会写入正式评审记录，必须由已签项目批准人审核其精确SHA-256
   并明确授权转录后，才能形成新的评审副本。

   为该精确迁移包生成待填确认模板，并预先绑定唯一评审输出路径：

   ```bash
   uv run navigator-data prepare-d0-post-adoption-confirmation \
     --bundle data/d0/candidates/d0_post_adoption_review_bundle.<date>.json \
     --review-output data/d0/review/d0_review_packet.<date>.json \
     --output data/d0/review/d0_post_adoption_review_confirmation.template.<date>.json
   ```

   项目批准人审核迁移包SHA-256后，将已完成确认副本保存到`data/d0/evidence`。副本必须
   保持绑定字段不变，填写本人姓名、ISO日期或带时区时间、`approved`/`rejected`决定和
   显式转录授权；拒绝时必须填写意见。批准后执行：

   ```bash
   uv run navigator-data apply-d0-post-adoption-review \
     --input data/d0/evidence/<completed-post-adoption-confirmation>.json \
     --bundle data/d0/candidates/d0_post_adoption_review_bundle.<date>.json \
     --review-output data/d0/review/d0_review_packet.<date>.json
   ```

   应用命令会重新生成并逐字节比较迁移包，只写出包内已经审核的拟副本。错误审核人、
   回溯日期、额外字段、包或拟副本哈希变化、拒绝决定和已有目标均失败且不产生输出。
   写出的副本仍只保留既有AC-001至008签署，AC-009/010及最终D0结论继续待审。

   将新评审副本、重建后的`data/contracts/current`及确认记录提交到Git后，生成AC-009
   收口复核候选包：

   ```bash
   uv run navigator-data prepare-d0-ac009-review \
     --authorization data/d0/candidates/d0_baseline_publication_authorization.<date>.json \
     --review data/d0/review/d0_review_packet.<date>.json \
     --output data/d0/candidates/d0_ac009_review_bundle.<date>.json
   ```

   该命令要求指定评审副本是目录中的最新版，并与发布授权、两份权威工作簿、合同清单、
   25份合同JSON和证据清单一起逐字节匹配当前Git提交。机器就绪报告只能剩余AC-009/010
   各自的待批准与缺证据四项自引用门禁，D0四项任务必须全部完成。生成包会列出AC-009所需
   的数据负责人和项目批准人实名签署模板，但不会写签名、登记证据、批准AC-009/010或完成D0。

   为该精确候选包生成空白实名确认模板，并绑定唯一的下一版评审路径：

   ```bash
   uv run navigator-data prepare-d0-ac009-confirmation \
     --authorization data/d0/candidates/d0_baseline_publication_authorization.<date>.json \
     --review data/d0/review/d0_review_packet.<date>.json \
     --bundle data/d0/candidates/d0_ac009_review_bundle.<date>.json \
     --review-output data/d0/review/d0_review_packet.<later-date>.json \
     --output data/d0/review/d0_ac009_confirmation.template.<later-date>.json
   ```

   数据负责人和项目批准人分别审核候选包精确SHA-256；即使由同一人兼任，也要保留两条
   角色签署。完成副本放入`data/d0/evidence`，设置明确决定、意见、每个角色的ISO签署时间
   和转录授权；签署日期必须与目标评审文件日期一致。批准时执行：

   ```bash
   uv run navigator-data apply-d0-ac009-confirmation \
     --input data/d0/evidence/<completed-ac009-confirmation>.json \
     --authorization data/d0/candidates/d0_baseline_publication_authorization.<date>.json \
     --review data/d0/review/d0_review_packet.<date>.json \
     --bundle data/d0/candidates/d0_ac009_review_bundle.<date>.json \
     --review-output data/d0/review/d0_review_packet.<later-date>.json \
     --manifest-output data/d0/evidence/manifest.json
   ```

   应用器为两个角色分别登记证据，临时重验AC-009签署及整份证据清单后，才原子发布新版
   评审并更新当前清单。拒绝决定、签署不全、错误人员/日期、额外字段、重复证据、哈希漂移、
   非当前证据清单或已有输出都会失败且不落库。成功后只剩AC-010和最终D0决定待审。

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
