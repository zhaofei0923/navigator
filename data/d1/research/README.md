# D1官方来源研究目录

`official_source_candidates.json`记录2026-07-31发现的41个五国官方候选入口，用于补齐
冻结工作簿中18个起始来源之外的候选数量：

| 国家 | 冻结起始来源 | 研究候选 | 候选合计 | active |
|---|---:|---:|---:|---:|
| 印尼 IDN | 2 | 18 | 20 | 0 |
| 越南 VNM | 2 | 6 | 8 | 0 |
| 沙特 SAU | 2 | 6 | 8 | 0 |
| 南非 ZAF | 2 | 6 | 8 | 0 |
| 巴西 BRA | 3 | 5 | 8 | 0 |

本目录是研究输入，不是准入登记。URL、机构名称和初步用途仍需在D1执行时重新核验，
并保存当日条款、许可、robots、访问限制和原始页面证据。任何候选在数据负责人和
合规负责人实际批准前都必须保持`under_review`。

修改目录后执行：

```bash
uv run navigator-data prepare-d1
uv run pytest tests/data_readiness/test_d1_sources.py
```

生成器会把本文件对应JSON的路径、SHA-256和内容哈希写入D1基线；漏项、重复ID、
非HTTPS入口、未知国家、越过`research_only`边界或国家候选数量不匹配都会阻止生成。
