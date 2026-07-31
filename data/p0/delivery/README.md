# P0交付证据评审副本

本目录用于存放实际P0版本的实现、测试、验收、指标和发布证据包。D4正式通过且P0
开发真实发生前，只保留本说明，不填写虚假完成状态。

## 使用流程

1. 重新生成并复制模板：

   ```bash
   uv run navigator-data prepare-p0-delivery
   cp data/p0/candidates/p0_delivery_evidence.template.json \
     data/p0/delivery/p0_delivery_evidence.<release>.json
   ```

2. 对每项需求、页面和API填写真实Git提交、执行人、日期和证据编号；对每项产品测试、
   工程测试和ACC验收填写真实执行/复核结论。
3. 将可提交、已脱敏且不含限制性数据的报告或哈希清单放在`data/p0/evidence`，并在
   包内登记仓库相对路径、SHA-256和实际包含该文件内容的完整Git提交SHA。不得提交
   凭据、生产转储、个人联系方式或原始限制性材料。
4. 填写发布指标和最终版本的构建、部署、回滚、恢复、移交结论。
5. 使用实际D4及其完整上游副本校验：

   ```bash
   uv run navigator-data validate-p0-delivery \
     --bundle data/p0/delivery/p0_delivery_evidence.<release>.json \
     --d4-bundle /安全的评审工作区/d4_acceptance_bundle.json \
     --d3-bundle /安全的评审工作区/d3_processing_bundle.json \
     --d2-bundle /安全的评审工作区/d2_collection_bundle.json \
     --d1-registry /安全的评审工作区/source_admission_registry.json \
     --d1-matrix /安全的评审工作区/domain_source_matrix.json \
     --d1-evidence /安全的评审工作区/d1_evidence_manifest.json
   ```

校验会重新执行完整D4→D3→D2→D1→D0链，核对当前P0追踪哈希、全部稳定编号、Git
提交存在性和可达性、证据路径与当前哈希、证据在声明提交中的Git blob哈希以及最终
硬门。所有实现和证据提交必须是最终发布提交的祖先，最终发布提交必须可从当前HEAD
到达。校验成功是提交项目委员会最终验收的必要条件，但不能代替实际授权人的批准。
