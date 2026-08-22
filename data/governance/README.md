# 项目基线决定记录

本目录保存项目级基线变更候选、具名确认、正式决定和实施范围澄清。它不替代
`data/d0`至`data/d4`的阶段证据，也不能凭机器生成内容自行批准变更。

当前生效决定为`PBD-ACCEL-DEMO-001`：项目批准人`kevin`于2026-08-22批准在D4前
开展受限的内部全栈demo。该demo只使用明确标记的合成数据，可在本地或访问受控的
私有环境展示；真实来源、正式账号权限、公开发布和生产采用仍受正式门禁约束。

审计链：

1. `candidates/accelerated_demo_baseline_change.2026-08-22.json`保存不可变候选；
2. `evidence/kevin_accelerated_demo_confirmation_20260822.json`保存具名确认；
3. `review/accelerated_demo_baseline_decision.2026-08-22.json`绑定两者SHA-256并使决定生效；
4. `review/demo_scope_clarification.2026-08-22.json`明确交付物必须是完整前后端内部demo。
