# D2不可变原始采集候选包

本目录由 `navigator-data prepare-d2` 从冻结批次、采集规则、原始资料模板和问题台账
生成。模板只定义采集合同和验收边界，不执行网络采集，也不代表D1来源已经获准使用。

| 文件 | 用途 | 当前结论 |
|---|---|---|
| `d2_collection_bundle.template.json` | 6个采集任务、批次、运行、L0原始对象和异常台账 | 任务均为planned，尚无实际运行或原始对象 |
| `stop_signal_catalog.json` | 登录、403、验证码、付费墙、许可、robots和漂移停止规则 | 所有高风险信号必须停止、留证且不得推进水位 |
| `d2_acceptance_assessment.json` | D2机器评估摘要 | D1依赖、运行证据、L0原始包和批次关闭均未通过 |

## 执行顺序

1. D1正式批准后，保留已批准的来源登记、数据域矩阵和哈希证据清单，复制bundle
   模板并将 `template_only` 改为 `false`；
2. 填写D1阶段门证据编号，将6个任务补齐连接器版本、范围、时区、水位、幂等键、
   去重键、限速、超时、重试、schema指纹和User-Agent策略；
3. 每次执行追加唯一 `run_id`，记录参数哈希、连接器版本、开始/结束时间、水位、
   HTTP摘要、重试次数和停止信号；
4. 失败、部分成功或停止运行不得推进已提交成功水位；
5. 每个L0对象登记完整来源链、URL、时间、MIME、大小、SHA-256、许可、存储对象、
   加密、恶意软件扫描、解析和保留状态；
6. 原始字节不得原地覆盖；Cookie、Token、密码和完整个人敏感信息不得进入通用日志；
7. 401/403、验证码、付费墙、地区限制、条款/robots变化、法律通知、个人信息越界、
   域名变化和schema漂移必须停止自动化并登记异常；
8. 批次只有在成功运行、原始对象、清单哈希、审核人和证据齐全后才能关闭；
9. 执行：

   ```bash
   uv run navigator-data validate-d2 \
     --bundle data/d2/d2_collection_bundle.json \
     --d1-registry data/d1/source_admission_registry.json \
     --d1-matrix data/d1/domain_source_matrix.json \
     --d1-evidence data/d1/d1_evidence_manifest.json
   ```

`validate-d2`会重新执行完整D1准入校验，包括当前D0门禁、来源状态、用途边界、
优先/替代来源矩阵及仓库内证据文件哈希；仅在D1来源表中填写`active`或伪造一个
上游证据编号不能进入D2。

## 强制禁止

- 验证码破解、凭证猜测、身份伪造、代理轮换规避封禁；
- 绕过登录、付费墙、地区限制、robots、许可或访问控制；
- 失败后推进成功水位，或用缓存/镜像继续发布被阻断来源的新内容；
- 覆盖原始文件、删除失败证据、把部分成功伪装为完整成功；
- 将请求Cookie、访问Token、密码或未脱敏个人信息写入运行清单。
