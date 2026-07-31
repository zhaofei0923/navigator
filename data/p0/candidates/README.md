# P0追踪预检候选包

本目录由`navigator-data prepare-p0-traceability`从只读
V1.0-BASELINE技术附件生成，用于在D4正式通过前盘点P0开发准入缺口，不表示产品
功能已经开始或完成。

- `p0_traceability_assessment.json`：汇总P0需求、页面、API、权限、测试和MVP验收数量，
  列出缺失或待细化的稳定编号映射及实现证据状态；
- `p0_traceability_matrix.json`：以90项P0需求为主键，反向关联页面、经页面推导的API、
  主权限代码、测试用例和MVP验收项。
- `p0_traceability_resolution.template.json`：逐项列出27个需求测试缺口、98个页面映射
  整改项和105种权限代码，供实际评审人提出带变更请求和证据的基线修订方案；
  任何新增需求、API、测试或权限编号还必须同时填写完整合同记录，不能只批准编号。
- `p0_delivery_evidence.template.json`：schema v5逐项列出90项P0需求、125个P0页面、
  56个P0 API、89项产品测试、17项工程测试、11项ACC验收、8类非委员会签署授权及
  最终发布硬门，并要求证据反向声明其覆盖的稳定主题、发布指标绑定最终提交。

权限矩阵使用`PERM-*`编号，而页面表使用权限代码；当前基线没有直接的
“权限代码→PERM编号”列，因此报告只保留两侧原始合同并明确提示，不能猜测映射；
当前105种页面权限代码全部计入追踪硬阻断，直到正式基线补齐并复核直接映射。

检查当前状态：

```bash
uv run navigator-data assess-p0-traceability --format json
```

重新生成：

```bash
uv run navigator-data snapshot
uv run navigator-data prepare-p0-traceability
uv run navigator-data prepare-p0-resolution
uv run navigator-data prepare-p0-delivery
```

填写副本后可执行：

```bash
uv run navigator-data validate-p0-resolution \
  --input data/p0/review/p0_traceability_resolution.<date>.json
```

校验通过只表示提案的编号、引用、冻结输入和复核元数据完整，可以进入正式基线变更
评审；不表示技术附件已经变更，也不表示整改已经生效。

拿到单独保存的候选技术附件后，可执行：

```bash
uv run navigator-data validate-p0-baseline-change \
  --resolution data/p0/review/p0_traceability_resolution.<date>.json \
  --workbook /安全的评审工作区/新能源企业出海导航仪_V1.0技术附件_CANDIDATE.xlsx \
  --output /安全的评审工作区/p0_baseline_change_assessment.json
```

该命令拒绝把权威源工作簿本身作为候选，比较公式合同以区分语义变更与缓存刷新，
核对新增编号、禁止删除原记录、增加未授权列或夹带未评审字段，逐项验证需求—测试、
页面—需求/API/测试和权限代码—`PERM-*`映射。新增合同记录必须与评审包中的完整
行定义逐字段一致；仅满足必填字段但内容不同也会失败。最后在候选附件上重新计算
P0追踪报告，只有所有提案精确落地且追踪阻断为0时才返回成功。

机器报告不能修改工作簿状态、代替D0—D4正式签署，也不能授权启动V0.1/P0用户侧开发。

正式开发、测试和验收发生后，按
[`../delivery/README.md`](../delivery/README.md)复制并填写P0交付证据包。只有完成
包已提交到`data/p0/delivery`并匹配当前`HEAD`，且完整D4上游链、当前P0追踪、全部
实现/测试/验收、D4项目委员会签署授权、发布指标、Git提交和证据哈希同时通过，
`evidence_ids`与`subject_refs`双向一致且不存在游离证据时，
`validate-p0-delivery`才返回成功。
