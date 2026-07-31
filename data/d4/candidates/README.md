# D4 质量、种子库与正式验收候选包

本目录用于 D4“审核、种子库、质量报告、演练和正式签署”的候选合同。机器校验只能
验证证据结构、计算口径和门禁一致性，不能替代真实数据、双人抽样、合规复核或项目
委员会签字。D4 正式通过前，不得启动 V0.1 用户侧产品开发。

## 生成内容

- `d4_acceptance_bundle.template.json`：生产来源、发布记录、质量问题、评分、覆盖、
  抽样、种子包、RAG候选、演练、移交和签署模板；
- `d4_scorecard.json`：七个维度、100分权重及不可被平均分掩盖的硬门；
- `d4_sampling_plan.json`：五国分层抽样及高风险/冲突/人工合并全量复核计划；
- `d4_acceptance_assessment.json`：当前机器可验证阻断项。

## 使用流程

```bash
uv run navigator-data prepare-d4
cp data/d4/candidates/d4_acceptance_bundle.template.json /安全的评审工作区/d4_acceptance_bundle.json
uv run navigator-data validate-d4 \
  --bundle /安全的评审工作区/d4_acceptance_bundle.json \
  --d3-bundle /安全的评审工作区/d3_processing_bundle.json \
  --d2-bundle /安全的评审工作区/d2_collection_bundle.json \
  --d1-registry /安全的评审工作区/source_admission_registry.json \
  --d1-matrix /安全的评审工作区/domain_source_matrix.json \
  --d1-evidence /安全的评审工作区/d1_evidence_manifest.json
```

`validate-d4`会重放D3、D2、D1和当前D0的完整上游校验。任何阶段文件中自报的
`approved`状态或孤立证据编号都不能代替可重放的上游事实、来源许可和证据哈希。

完整副本至少必须证明：

- D3 已正式通过，且每条发布记录来自未被篡改的 D3 候选；
- 印尼核心字段完整率不低于90%，比较国各不低于70%，五国各数据域达到冻结最低量；
- 七个评分维度总分不低于85，且每维不低于该维满分的70%；
- 发布关键事实追溯、生产来源许可元数据、必填/枚举校验均为100%；
- 抽样准确率不低于95%，高风险/冲突/人工合并样本为100%，有效重复率不高于1%；
- P0问题、撤权来源索引残留和权限泄漏均为0；
- 种子包可从空库导入、从冻结输入重建、回滚不删历史、来源撤权后页面/导出/搜索/AI
  均不再使用失效内容；
- 九项移交物由独立角色签收，D4-01至D4-04有证据，数据、质量、合规、技术和项目
  委员会完成实名批准。

模板与机器评估可提交仓库；真实限制性原件、个人联系方式、凭据、生产转储和未脱敏
证据不得提交。
