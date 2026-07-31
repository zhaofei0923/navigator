# P0追踪预检候选包

本目录由`navigator-data prepare-p0-traceability`从只读
V1.0-BASELINE技术附件生成，用于在D4正式通过前盘点P0开发准入缺口，不表示产品
功能已经开始或完成。

- `p0_traceability_assessment.json`：汇总P0需求、页面、API、权限、测试和MVP验收数量，
  列出缺失或待细化的稳定编号映射及实现证据状态；
- `p0_traceability_matrix.json`：以90项P0需求为主键，反向关联页面、经页面推导的API、
  主权限代码、测试用例和MVP验收项。

权限矩阵使用`PERM-*`编号，而页面表使用权限代码；当前基线没有直接的
“权限代码→PERM编号”列，因此报告只保留两侧原始合同并明确提示，不能猜测映射。

检查当前状态：

```bash
uv run navigator-data assess-p0-traceability --format json
```

重新生成：

```bash
uv run navigator-data snapshot
uv run navigator-data prepare-p0-traceability
```

机器报告不能修改工作簿状态、代替D0—D4正式签署，也不能授权启动V0.1/P0用户侧开发。
