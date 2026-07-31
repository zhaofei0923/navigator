# P0非限制性证据

本目录只允许保存可提交、已脱敏且不含凭据、个人联系方式、生产转储或限制性原件的
P0证据及哈希清单。每个文件必须在P0交付证据包中登记稳定证据编号、仓库相对路径、
SHA-256、包含该精确文件内容的完整Git提交SHA、生成者、生成时间和批准状态。验证器
会同时核对当前文件和该提交中的Git blob，二者都必须等于声明的SHA-256。

示例：

```json
{
  "evidence_id": "EVD-P0-EXAMPLE",
  "artifact_type": "test_report",
  "path": "data/p0/evidence/example.json",
  "sha256": "<64位小写SHA-256>",
  "commit_sha": "<40或64位完整Git提交SHA>",
  "generated_by": "<实际生成者>",
  "generated_at": "<ISO-8601时间>",
  "status": "approved",
  "contains_restricted_data": false
}
```

敏感或限制性原件留在获准的外部证据库；仓库内只保存经批准的非敏感摘要或哈希清单。
