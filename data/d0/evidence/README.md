# D0 验收证据

`manifest.json` 只登记真实存在、可复核的验收证据。每条记录至少包含：

```json
{
  "evidence_id": "EVD-D0-001",
  "acceptance_id": "D0-AC-001",
  "path": "data/d0/evidence/files/example.pdf",
  "sha256": "64位小写SHA-256",
  "recorded_by": "实际执行人",
  "recorded_at": "2026-07-31T00:00:00+08:00",
  "reviewer": "实际复核人",
  "status": "已复核"
}
```

规则：

- 不提交密码、密钥、私人联系方式或无权再分发的原始材料；
- 证据文件必须位于仓库内，路径不能使用 `..` 逃逸；
- 修改证据文件后必须更新哈希并重新复核；
- `data/d0/candidates/machine_evidence_review_queue.json`中的条目只是待审模板；机器状态
  为`fail`时必须先修复冻结合同，状态为`pass`也必须由指定实名角色检查文件和哈希；
- 只有人工明确批准后，才可补齐复核人、时间和批准状态并登记候选机器证据；
- 工具验证证据完整性，但不能代替有权人员签署。
