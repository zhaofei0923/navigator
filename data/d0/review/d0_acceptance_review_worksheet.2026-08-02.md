# D0 当前可验收项人工复核表

> 本文件是待填审核表，不是批准记录。只有正式角色持有人可审核。
> 审核通过仍不代表D0/D4完成，也不会激活权威工作簿或授权用户侧开发。

## 绑定对象

- 验收候选包：`data/d0/candidates/d0_acceptance_review_bundle.2026-08-02.json`
- 验收候选包SHA-256：`9ae32733d9ae3c973a63f382952f057b20d8a82a2bccb28d11a13a3be8bd86b7`
- 候选工作簿SHA-256：`123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712`
- 整改包SHA-256：`bac2d22c2cdc6019ec01e86c223428e0720cdd16b22fe3b1f08a569fe0a440b8`
- 权威工作簿SHA-256：`224e9a35bcbb363cf41c007499ba32aa6394cfdbf06331830c02d994e1c7ddff`

## 状态汇总

- 可人工审核：D0-AC-001、D0-AC-002、D0-AC-003、D0-AC-004、D0-AC-005、D0-AC-006、D0-AC-008
- 已批准：D0-AC-007
- 仍阻断：D0-AC-009、D0-AC-010

## 逐项结论

### D0-AC-001 核心实体有唯一代码、主键和权威关系

- 所需角色：数据负责人、后端/数据架构负责人
- 证据候选编号：`EVD-D0-AC-001-REVIEW-20260802`
- 绑定证据：
  - `123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712` `data/d0/candidates/d0_core_contract_candidate.2026-08-01.xlsx` (candidate core-entity contract)
  - `bac2d22c2cdc6019ec01e86c223428e0720cdd16b22fe3b1f08a569fe0a440b8` `data/d0/review/core_contract_resolution.2026-08-01.json` (reviewed AC-001/002 resolution packet)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-002 核心字段有唯一代码、类型、单位、空值和来源规则

- 所需角色：数据负责人、数据质量负责人
- 证据候选编号：`EVD-D0-AC-002-REVIEW-20260802`
- 绑定证据：
  - `123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712` `data/d0/candidates/d0_core_contract_candidate.2026-08-01.xlsx` (candidate core-field contract)
  - `bac2d22c2cdc6019ec01e86c223428e0720cdd16b22fe3b1f08a569fe0a440b8` `data/d0/review/core_contract_resolution.2026-08-01.json` (reviewed AC-001/002 resolution packet)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-003 状态枚举中文、代码、互斥关系和迁移规则一致

- 所需角色：数据负责人、产品负责人
- 证据候选编号：`EVD-D0-AC-003-REVIEW-20260802`
- 绑定证据：
  - `2631d3ef2cff7ed5de7952877c07779565608e4de05601d7508ebb0f70472283` `data/d0/candidates/enum_migration_evidence.json` (enum and migration machine evidence)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-004 时区、货币、单位、精度和多语言规则已批准

- 所需角色：产品负责人、数据负责人、语言审校负责人
- 证据候选编号：`EVD-D0-AC-004-REVIEW-20260802`
- 绑定证据：
  - `137410a9eeeeb971e1187dc150f42360772539605cf31f0ac3126bffc57fbc9d` `data/d0/candidates/conventions.json` (approved convention candidate)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-005 来源、原始资料、字段映射、审核和D4模板试填通过

- 所需角色：数据质量负责人、数据工程负责人
- 证据候选编号：`EVD-D0-AC-005-REVIEW-20260802`
- 绑定证据：
  - `1e7e794f46ab75eb1ce7115ca4c3478e05934bb5b057dea9955f2ba45e7d5b4d` `embedded:effective_template_trial` (mapping-aware D4 template trial)
  - `91385044494b13879b1f3ced2c7b9b391827bb6c2ee6fef129cd02ef9f0ad31a` `embedded:effective_gold_standard` (review-aware gold-standard assessment)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-006 金标准样本与术语表由专业人员复核

- 所需角色：国家研究负责人、语言审校负责人
- 证据候选编号：`EVD-D0-AC-006-REVIEW-20260802`
- 绑定证据：
  - `9778fb039d980f62470f72e9d2eb45ea9a9575ffa0e4ff9f48485ea25af01c37` `data/d0/candidates/terminology_review_queue.json` (approved terminology candidate)
  - `91385044494b13879b1f3ced2c7b9b391827bb6c2ee6fef129cd02ef9f0ad31a` `embedded:effective_gold_standard` (professionally reviewed gold-standard assessment)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

### D0-AC-008 变更、版本、证据目录和文件命名规则可执行

- 所需角色：数据负责人、合规负责人
- 证据候选编号：`EVD-D0-AC-008-REVIEW-20260802`
- 绑定证据：
  - `f659ad3b577080736881ec9412592e64b699d0b197b3a09b858b3921eee53b85` `data/d0/candidates/file_rules.json` (approved file and evidence rules)
- 对上述验收项及验收候选包精确哈希的结论：`approved` / `rejected`：
- 复核人：
- 复核日期 (ISO日期或带时区时间)：
- 意见：

## 暂不可批准

- D0-AC-009：须等待D0-AC-001至008全部完成，并证明阻塞项为0；
- D0-AC-010：须等待所有前置验收、任务状态和证据完成后由项目批准人最终签署。
