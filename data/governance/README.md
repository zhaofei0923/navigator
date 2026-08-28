# 项目基线决定记录

本目录保存项目级基线变更候选、具名确认、正式决定和实施范围澄清。它不替代
`data/d0`至`data/d4`的阶段证据，也不能凭机器生成内容自行批准变更。

`PBD-ACCEL-DEMO-001`继续授权仅使用合成数据的受限内部demo。
`PBD-BASIC60-PRIVATE-001`已由项目批准人`kevin`于2026-08-26批准并生效，另行授权
60国真实Basic数据进入隔离的私有试用准备链。两套环境、数据、凭据和发布状态必须
保持隔离。

Basic60原决定只允许国家档案、宏观和能源数据的私有试用准备，不允许政策或公开发布，
也不完成正式D1-D4、P0、`private_trial_ready`或生产发布。2026-08-26生效的
`PBD-BASIC60-PRIVATE-001-A1`由项目批准人作出唯一人工许可决定：全部规范化Basic60字段可
用于内部学习展示、内部AI、本地模型和受控外部模型处理；公开发布和模型训练仍禁止，V1也
不部署AI、向量、搜索或模型运行能力。系统只验证人工决定的身份、范围、时间和证据哈希，
不从来源条款推断许可，也不保存来源级第二套许可状态。

同日生效的`PBD-BASIC60-PRIVATE-001-A2`进一步把私有试用D1—D4的人工作业收敛为一份集中
Excel和项目批准人`kevin`的一次批准。Excel包含全部Basic60数据和来源，批准必须精确绑定
工作簿SHA-256与规范数据/来源载荷SHA-256。A2生效时只批准这一简化流程，并如实记录当时
Excel数据仍为`pending_user_review`。此后`kevin`已另行审核并批准当前精确Excel与规范载荷；
验证结果为`private_trial_ready`且`checks=[]`。该后续批准不回写或改变A2的历史记录，也不
完成正式D1—D4、P0、生产或公开发布，以上状态继续为`pending`或未授权。

该私有路径不再要求三批人工签收、固定180项抽样、两名独立审核人或五角色顺序签署。后台仍
保留来源绑定、数据/载荷哈希、D3可重放、隔离、撤销和V1 AI运行能力关闭等机器控制。来源仅
在集中Excel和后台审计材料中可见，普通UI/API不显示来源。

审计链：

1. `candidates/accelerated_demo_baseline_change.2026-08-22.json`保存不可变候选；
2. `evidence/kevin_accelerated_demo_confirmation_20260822.json`保存具名确认；
3. `review/accelerated_demo_baseline_decision.2026-08-22.json`绑定两者SHA-256并使决定生效；
4. `review/demo_scope_clarification.2026-08-22.json`明确交付物必须是完整前后端内部demo。

Basic60候选审计链：

1. `candidates/basic60_private_baseline_change.2026-08-25.json`保存不可变候选；
2. `review/basic60_private_baseline_confirmation.template.2026-08-25.json`绑定候选哈希，
   仅供具名项目批准人复制并填写；
3. `evidence/kevin_basic60_private_confirmation_20260825.json`保存项目批准人的具名确认；
4. `review/basic60_private_baseline_decision.2026-08-25.json`绑定确认文件哈希并使决定生效；
5. `review/basic60_private_internal_review_clarification.2026-08-26.json`记录官方公开来源
   确认、一次集中D1批准和人工增量更新规则；
6. `evidence/kevin_basic60_ai_and_source_visibility_confirmation_20260826.json`保存项目批准人
   对全字段使用及来源隐藏的具名确认；
7. `review/basic60_private_usage_amendment.2026-08-26.json`绑定该确认并使A1人工许可生效；
8. `evidence/kevin_basic60_single_excel_review_process_confirmation_20260826.json`保存项目批准人
   对单Excel、单批准流程的确认；
9. `review/basic60_private_single_excel_review_amendment.2026-08-26.json`绑定该确认并使A2流程
   修正生效。该文件保留流程生效时数据仍待实际Excel审核的历史状态；
10. `../basic60/evidence/basic60_excel_review_approval.2026-08-26.json`记录`kevin`对工作簿
    SHA-256 `163a48df8772f5d8a5fc2638240d9f117fec5d0fbb439246319b4fd881e44dd8`
    和规范载荷SHA-256
    `087f355987d160f828aa70f92eda82b26b2b68bb4f9a673761c18b85ca18b657`的后续精确批准，
    证据文件SHA-256为
    `29a4c5a2dcc1bbdd9c16e4fd5581473b38f663238f3f24882b3894b01e963188`；
11. `../basic60/review/basic60_private_excel_review.approved.2026-08-26.json`绑定批准证据并形成
    批准后审核包，SHA-256为
    `663851956a197452e07aef7cf9227ba3b04ed06aecc5c883061ed406daa1cacc`；
12. `../../runtime/basic60/basic60_private_validation.json`验证该批准包为
    `private_trial_ready`且`checks=[]`，SHA-256为
    `2e440751c7cfa005833ebc5fd616432eb13df267022541ae5e9839ecabb1f291`。60项用电需求在R1
    暂不要求补齐，保持`pending`且不转零，不改变61项冻结`pending`计数，也不构成私有试用
    阻断项。
