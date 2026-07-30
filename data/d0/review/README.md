# D0正式评审包

本目录把D0剩余决策、责任签署、样本合规/专业复核和10项硬门集中到一个可机检的
评审包。模板由冻结工作簿和 `data/d0/candidates` 候选结论生成，不代表任何人已批准。

## 使用顺序

1. 先刷新候选和模板：

   ```bash
   uv run navigator-data prepare-d0
   uv run navigator-data prepare-d0-review
   ```

2. 复制模板，文件名必须明确包含实际评审批次，例如：

   ```bash
   cp data/d0/review/d0_review_packet.template.json \
     data/d0/review/d0_review_packet.2026-08-01.json
   ```

3. 由实际责任人填写副本，不要编辑模板。必须完成：

   - 9个角色的实名责任人、替补、升级角色、签署时间和签署证据编号；
   - 6条字段映射的最终处理、目标、理由、变更单、决策人和证据编号；
   - 3条金标准样本的原件、许可快照、再分发/AI边界和专业复核；
   - 3份候选规范的指定角色复核；
   - D0-AC-001至D0-AC-010的复核人、时间和证据编号；
   - 项目批准人的D0最终结论。

4. 校验评审副本：

   ```bash
   uv run navigator-data validate-d0-review \
     --input data/d0/review/d0_review_packet.2026-08-01.json
   ```

5. 将证据登记到 `data/d0/evidence/manifest.json`，再更新正式工作簿并重新运行
   `snapshot`、`prepare-d0`、`validate`和`gate --stage D0`。

## 安全与审计边界

- 不得由开发代理、脚本或机器检查代替责任人签署；
- 不得在评审包中填写电话、私人邮箱、身份证件、密钥或其他非必要个人信息；
- `evidence_ids`必须能对应到证据清单，证据文件需经过再分发和隐私审查；
- 模板中的基线哈希必须与当前冻结工作簿一致；不一致时重新生成，禁止复制旧批准；
- 来源被拒绝时必须更换样本，不得把“已作决定”误报为“已获准使用”。
