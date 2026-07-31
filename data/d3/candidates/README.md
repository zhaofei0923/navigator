# D3 可重放处理候选包

本目录用于 D3“清洗、标准化、翻译与实体解析”的候选合同和提交前检查。它不包含
正式生产数据，也不授权发布、搜索或 AI 索引。D2 门禁未通过、批次未关闭、L0
原件不可变性不成立时，D3 校验必须失败。

## 生成内容

- `d3_processing_bundle.template.json`：三段流水线、运行清单、候选记录、字段值、
  翻译、实体决策、冲突和可撤销合并模板；
- `d3_rule_catalog.json`：来源保留、单位/币种/时间、翻译、实体、冲突和发布边界；
- `d3_acceptance_assessment.json`：当前机器可验证的阻断项，不代替人工审批。

三段固定流水线为：

1. `D3-PARSE`：L0 → L0.5，执行格式解析、语言识别、来源定位和字段映射；
2. `D3-STANDARDIZE`：L0.5 → L1，保留原值并执行单位、币种、日期、枚举和翻译；
3. `D3-ENTITY`：L1 → L2-candidate，执行实体匹配、去重、冲突登记和候选版本化。

## 使用流程

```bash
uv run navigator-data prepare-d3
cp data/d3/candidates/d3_processing_bundle.template.json /安全的评审工作区/d3_processing_bundle.json
uv run navigator-data validate-d3 \
  --bundle /安全的评审工作区/d3_processing_bundle.json \
  --d2-bundle /安全的评审工作区/d2_collection_bundle.json \
  --d1-registry /安全的评审工作区/source_admission_registry.json \
  --d1-matrix /安全的评审工作区/domain_source_matrix.json \
  --d1-evidence /安全的评审工作区/d1_evidence_manifest.json
```

`validate-d3`会重新执行完整D2采集校验；D2校验又会验证D1来源、数据域矩阵、证据
哈希和当前D0门禁。仅在D3或D2文件中填写“上游已批准”不能绕过完整上游链。

填写副本时必须：

- 将 `template_only` 改为 `false`，绑定真实 D2 门禁证据，并使用已经关闭的 D2
  批次和不可变 L0 对象；
- 为每条记录绑定解析、标准化和实体三段成功运行；运行必须保存代码版本、规则版本、
  参数哈希及输入输出清单；
- 原文、译文、原值和标准值分层保存；单位、币种与时间换算保存规则和来源；
- 未知枚举、模糊实体和开放冲突进入 `needs_review`，不得自动覆盖或自动发布；
- 模糊合并必须先预览、由人工确认、保存历史 ID 映射且可撤销。

模板和评估文件可提交仓库；真实原件、限制性材料、个人联系方式、凭据及未脱敏证据
不得提交。
