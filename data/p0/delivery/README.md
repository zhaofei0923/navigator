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

2. 由D4中已批准的项目委员会签署人批准`signer_authorizations`：覆盖全部非委员会
   ACC复核角色和测试负责人，并为每项授权填写实名、日期和委员会批准的证据编号。
   项目委员会角色不在本清单中自授权，直接使用D4批准记录中的唯一实名签署人。
3. 对每项需求、页面和API填写真实Git提交、执行人、日期和证据编号；对每项产品测试、
   工程测试和ACC验收填写真实执行/复核结论及复核角色。复核姓名与角色必须匹配上述
   授权清单；项目委员会验收项必须匹配D4项目委员会签署人。
4. 将可提交、已脱敏且不含限制性数据的报告或哈希清单放在`data/p0/evidence`，并在
   包内登记仓库相对路径、SHA-256和实际包含该文件内容的完整Git提交SHA。不得提交
   凭据、生产转储、个人联系方式或原始限制性材料。每份证据还必须填写批准人、批准
   角色、批准日期及其明确覆盖的`subject_refs`；批准人必须在签署授权链中。事项
   `evidence_ids`与证据`subject_refs`必须双向对应，禁止未知主题和未被引用的游离证据。
   路径必须是规范的仓库相对路径，且解析后仍位于`data/p0/evidence`内；绝对路径、
   `.`/`..`别名、符号链接逃逸和其他仓库目录均不接受。
5. 填写发布指标和最终版本的构建、部署、回滚、恢复、移交结论；最终发布批准人必须
   是D4项目委员会的唯一实名签署人。所有`*_at`字段必须是`YYYY-MM-DD`或带时区的
   ISO-8601时间；测试复核不得早于执行，证据批准不得早于生成。
6. 将完成包提交到Git；校验器拒绝仓库外路径、未进入当前`HEAD`的文件，以及与当前
   `HEAD`中同路径Git blob不一致的工作区副本。
7. 使用实际D4及其完整上游副本校验：

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

校验会先确认完成包位于`data/p0/delivery`且逐字节匹配当前`HEAD`中的Git blob，再
重新执行完整D4→D3→D2→D1→D0链，核对当前P0追踪哈希、全部稳定编号、Git提交
存在性和可达性、证据路径与当前哈希、证据在声明提交中的Git blob哈希以及最终硬门。
校验同时从D4批准包提取唯一项目委员会签署人，核对签署授权、测试复核、ACC验收、
证据批准和最终发布批准链，并逐项核对`evidence_ids`与`subject_refs`的双向绑定。
所有实现和证据提交必须是最终发布提交的祖先，最终发布提交必须可从当前HEAD到达。
校验成功是提交项目委员会最终验收的必要条件，但不能代替实际授权人的批准。
