# 新能源企业出海导航仪

本仓库以 `doc/doc` 下已审核的 V1.0-BASELINE 为唯一开发基线。当前执行阶段是
D0 数据标准冻结；D4 数据就绪评审正式通过之前，只建设数据准备、采集、质量和验收
工具，不启动 V0.1 用户侧产品功能。

## 当前可运行能力

- 从 D0 执行台账和技术附件中只读提取实体、字段、枚举、规则、国家范围与任务；
- 校验工作簿结构、唯一编号、任务依赖和冻结基线哈希；
- 生成可版本化的数据合同快照；
- 输出 D0 就绪报告，并对缺少签署、任务、验收和证据给出明确阻断原因；
- 校验验收证据文件的哈希和关联关系。

## 本地运行

要求 Python 3.13。推荐使用 `uv`：

```bash
uv sync --dev
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run navigator-data validate
uv run navigator-data snapshot
uv run navigator-data prepare-d0
uv run navigator-data assess-d0
uv run navigator-data prepare-d0-review
uv run navigator-data prepare-d1
uv run navigator-data report
uv run pytest --cov
```

`validate` 只检查冻结基线结构，可用于持续集成。正式阶段门使用：

```bash
uv run navigator-data gate --stage D0
```

在当前台账尚未完成责任签署和验收的情况下，该命令应返回非零状态；这是正确的门禁行为。

`prepare-d0`生成的候选验收包位于
[`data/d0/candidates`](data/d0/candidates/README.md)。当前模板试填已定位6条未知字段
目标。印尼 ESDM 与越南 EVN 两份公开原件已完成来源、日期、文件哈希和 PDF
安全属性核验，但许可快照和专业复核仍待完成；沙特样例尚未绑定具体原件。这些问题
修复并签署前，工具不会允许D0通过。

正式责任人可按
[`data/d0/review`](data/d0/review/README.md)中的流程复制评审模板，填写角色、映射、
样本、候选规范和D0-AC-001至010的实际决策，再用 `validate-d0-review` 做提交前检查。
该检查只验证完整性和基线一致性，不能代替授权与签署。

D1候选包位于
[`data/d1/candidates`](data/d1/candidates/README.md)。它固化印尼20个、四个比较国
各8个active来源门槛，并要求五国40个“国家×核心数据域”组合分别绑定不同的优先
来源和替代来源。D0未通过、许可或访问边界未决时，`validate-d1`必须失败。

完整实施顺序见
[`docs/development/P0_IMPLEMENTATION_PLAN.md`](docs/development/P0_IMPLEMENTATION_PLAN.md)。
