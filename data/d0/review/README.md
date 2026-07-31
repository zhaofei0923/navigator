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

   该命令通过只说明整改提案可进入正式基线变更评审，不会更新本评审包的机器状态。

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
