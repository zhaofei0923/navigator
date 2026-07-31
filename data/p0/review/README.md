# P0追踪整改评审副本

本目录只存放由实际评审人填写的P0追踪整改提案。先复制
`../candidates/p0_traceability_resolution.template.json`，文件名应包含评审日期；
不要直接修改候选模板。

评审副本必须：

- 保留当前工作簿与P0候选哈希；
- 对模板列出的每个缺口提出稳定编号或明确“不适用”结论；
- 新编号先登记到`proposed_contract_ids`，并在`proposed_contract_rows`填写完整非空
  合同记录；记录只能使用模板`proposed_contract_schema`允许的字段，不得冒充现有合同；
- 填写变更请求、理由、复核人、日期、最终变更集和证据编号；
- 将`template_only`改为`false`后执行`validate-p0-resolution`。

机器校验只证明提案结构与当前基线一致。技术附件仍是只读权威源，提案必须经过
正式基线变更评审后才能生效。

整改包校验通过后，可原子生成独立候选技术附件，并可再次独立验证：

```bash
uv run navigator-data prepare-p0-baseline-change \
  --resolution data/p0/review/p0_traceability_resolution.<date>.json \
  --output /安全的评审工作区/新能源企业出海导航仪_V1.0技术附件_CANDIDATE.xlsx \
  --assessment-output /安全的评审工作区/p0_generation_assessment.json

uv run navigator-data validate-p0-baseline-change \
  --resolution data/p0/review/p0_traceability_resolution.<date>.json \
  --workbook /安全的评审工作区/新能源企业出海导航仪_V1.0技术附件_CANDIDATE.xlsx \
  --output /安全的评审工作区/p0_baseline_change_assessment.json
```

成功要求每个新增合同记录逐字段等于评审包中的完整行定义，并证明候选附件所有其他
单元格和公式不变且P0追踪阻断为0。生成器拒绝覆盖、拒绝写入`doc`，验证不通过不
发布；两个命令都不会激活候选附件。
只有经授权完成正式基线替换后，`assess-p0-traceability`和D4才会读取新权威基线。
