# P0非限制性证据

本目录只允许保存可提交、已脱敏且不含凭据、个人联系方式、生产转储或限制性原件的
P0证据及哈希清单。每个文件必须在P0交付证据包中登记稳定证据编号、仓库相对路径、
SHA-256、包含该精确文件内容的完整Git提交SHA、生成者、生成时间、批准人、批准角色、
批准时间、批准状态和明确覆盖的`subject_refs`。批准人及角色必须匹配D4项目委员会
或其批准的P0签署授权清单；签署授权证据本身必须由D4项目委员会签署人批准。验证器
会同时核对当前文件和该提交中的Git blob，二者都必须等于声明的SHA-256。

示例：

```json
{
  "evidence_id": "EVD-P0-EXAMPLE",
  "artifact_type": "test_report",
  "path": "data/p0/evidence/example.json",
  "sha256": "<64位小写SHA-256>",
  "commit_sha": "<40或64位完整Git提交SHA>",
  "subject_refs": [
    "requirements:FR-EXAMPLE",
    "product_tests:TC-EXAMPLE"
  ],
  "generated_by": "<实际生成者>",
  "generated_at": "<ISO-8601时间>",
  "approved_by": "<实际批准人>",
  "approval_role": "<项目委员会或已授权角色>",
  "approved_at": "<ISO-8601时间>",
  "status": "approved",
  "contains_restricted_data": false
}
```

`subject_refs`必须使用以下稳定格式，并且至少有一项：

- 实现、测试和验收：`requirements:<ID>`、`routes:<ID>`、`apis:<ID>`、
  `product_tests:<ID>`、`engineering_tests:<ID>`或`acceptance_items:<ID>`；
- 签署授权：`signer_authorizations:<角色>:<实名>`；
- 发布指标和最终发布：`release_metrics`、`final_release`。

事项中的`evidence_ids`与证据中的`subject_refs`必须双向一致。证据不能声明不存在的
主题，也不能作为未被任何事项引用的游离记录。

敏感或限制性原件留在获准的外部证据库；仓库内只保存经批准的非敏感摘要或哈希清单。
