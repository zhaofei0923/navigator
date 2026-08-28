# 单国扩展与确认后发布包操作说明

本入口用于在保留已确认 `BASIC60-PRIVATE-R1` 的前提下，准备一个新增海外国家的数据与概述审核包。它不替代原有 Basic60 导入器，也不改变正式 D1—D4、P0 状态。

## 当前边界

- 父种子必须是原始60国（含中国）的完整 `BASIC60-PRIVATE-R1` 就绪种子；校验原有60国、300条宏观年度记录、60条能源记录、2279个有值观测与61个待补值。
- 新增一个原范围外、非中国的国家。候选保留原60国逐国内容哈希，形成原始61国、海外60国范围；既有59个海外国家不需要重新人工审核。
- 新增国家使用独立目标数据版本 `BASIC61-PRIVATE-R1`，不修改旧版本的固定计数、合同、历史审核包或运行配置。
- 候选始终为 `awaiting_single_review`、`published=false`；机器通过只返回 `candidate_valid`，不生成 `private_trial_ready`、签名、发布指针或数据库记录。
- 候选入口没有发布、批准或激活选项。准备审核包不会让线上增加一个国家；确认后须显式使用下述独立发布包构建入口，且构建仍不等于在线激活。

## 输入

所有输入与原始证据必须是仓库内的真实文件，不允许符号链接、路径逃逸或凭据 URL。读取不会改写原文件。输入文件及下载证据的 SHA-256 被绑定到候选，后续重放发现任何变化即失败。

1. `--parent-seed`：未改动的 Basic60 就绪种子。
2. `--profile-csv`：只含新增国家一行，沿用原 `country_profile.csv` 字段；名称、语言、本地名、货币、IANA 时区与行政区结构保留原数据。
3. `--metrics-csv`：沿用原 `macro_energy.csv` 字段，只含该国2020—2024五条宏观行及一条能源行。
4. `--evidence`：下述来源映射 JSON；这里只记录依据，不设置系统许可或人工批准状态。
5. `--overview`：可选、符合 `navigator.market-overview.v1` 的单国中英文概述 JSON，国家与信息日期须一致。最终交付同一份审核表时应提供该项。
6. `--as-of`：明确的信息日期，`YYYY-MM-DD`。

数值拆为39个指标观测：2个档案指标、30个宏观指标、7个能源指标（含可为空的用电需求）。实际有值及待补数量按输入计算；空白保持 `pending` 而非补零。负增长、负FDI、真实零及超过100%的通胀允许；同年能源分量与占比须一致，不把不同统计年强行配对。所有可用值须有统计年和来源引用，统计年不得晚于信息日期。

来源映射示例（省略号必须替换为实际值，未下载的材料不可填假哈希）：

```json
{
  "schema_version": "navigator.country-extension-evidence.v1",
  "country_code": "ZMB",
  "sources": [
    {
      "id": "SOURCE-ID",
      "title": "实际官方资料标题",
      "url": "https://official.example/path",
      "captured_at": "2026-08-28T12:00:00+08:00",
      "local_path": "raw material/countries/ZMB/path/to/downloaded.json",
      "sha256": "实际文件的64位SHA-256"
    }
  ],
  "identity_source_ids": ["SOURCE-ID"],
  "metric_source_ids": {
    "gdp_current_usd": ["SOURCE-ID"]
  }
}
```

`metric_source_ids` 必须覆盖所有有值指标；同一指标的多个年份可共用一组来源文件。来源捕获时间必须含时区、不得晚于信息日期，文件保留于 `raw material` 内。

## 准备与重放

在仓库根目录执行（WSL内已有锁定环境时，可将 `uv run navigator-data` 换为 `.venv/bin/navigator-data`）：

```sh
uv run navigator-data prepare-country-extension \
  --parent-seed runtime/basic60/basic60_seed.private_trial_ready.json \
  --profile-csv "raw material/countries/ZMB/00_country_profile/country_profile.csv" \
  --metrics-csv "raw material/countries/ZMB/00_country_profile/macro_energy.csv" \
  --evidence runtime/country-expansion/zmb-20260828-r1/basic-evidence.json \
  --overview runtime/market-overview/zmb-20260828-r1/countries/ZMB.json \
  --as-of 2026-08-28 \
  --revision 1 \
  --output-dir runtime/country-extensions/zmb-20260828-r1

uv run navigator-data validate-country-extension \
  --candidate-dir runtime/country-extensions/zmb-20260828-r1
```

`--overview` 路径以实际生成文件为准，不自动从旧分析或报告转换。输出必须是 `runtime/country-extensions` 下尚不存在的子目录；重复准备必须选择新的版本目录。输出采用同目录临时文件、完整重放后原子创建，不覆盖已有目录。

输出：

| 文件 | 用途 |
| --- | --- |
| `candidate.json` | 冻结父种子、输入、证据、新增国家及可选概述的版本清单；不是可导入种子 |
| `review-data.json` | 制表器输入，包含新增国字段、依据与原60国保全信息 |
| `scope.csv` | 原始61国及海外60国范围审计；中国标记为 `origin_excluded` |
| `validation.json` | 生成时的机器重放结果；不是人工作出确认的记录 |

## 一份 Excel、一次实际确认

审核表同时包含基础数据与概述，但两者共享实际工作簿哈希，不要求分别签署。概述继续使用已有制表器与导入合同，不再另存一份可编辑概述：

| 工作表 | 合同 |
| --- | --- |
| `新增国包信息` | `review-data.json.metadata` 的 `key,value` 两列 |
| `新增国内容` | `country_code,section,locale,json_pointer,original_value,edited_value,source_ids` 七列，仅身份与指标 |
| `基础数据依据` | `id,title,url,captured_at,local_path,sha256` 六列 |
| `包信息` | 现有 `navigator.market-review.v1` 概述元信息 |
| `内容编辑` | 现有六列概述编辑合同 |

身份指针是 `/new_country/identity/{field}`，ISO2另以 `/new_country/iso2` 标识；每个指标按 `/new_country/metrics/{index}/{field}` 单字段一行。数值、空值、数组和元信息一律以明确文本存储：空值写为文本 `null`，数组为JSON文本，ISO日期不得被Excel自动转成日期序号。初始原值与编辑值相同；合同工作表不能使用公式或错误单元格。

`navigator.country-extension-review.v1` 对 `基础数据依据` 六列表的 **captured_at列** 规定唯一的 `canonical_json_string` 序列化：单元格存完整ISO时间字符串的JSON编码，包含首尾双引号，例如 `"2026-08-28T11:02:56.225285+08:00"`。精确值等于 `json.dumps(original_iso_string, ensure_ascii=False, separators=(',', ':'))`；时区、秒和微秒全部保留。这是避免制表工具自动将ISO时间转为Excel数字并丢失精度的可逆文本编码，仅适用于该列。候选、`source_rows` 和原始证据仍保存原ISO串，哈希不变。验证器不剥除字符、不接受前缀单引号、不接受多余空白、不回推日期数字，也不接受截断的时间或双重编码；其余列继续逐字匹配原值。

最终审核表完成后执行：

```sh
uv run navigator-data validate-country-extension \
  --candidate-dir runtime/country-extensions/zmb-20260828-r1 \
  --workbook "outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx"
```

验证器重放全部输入，再逐项校验新增国元信息、字段和依据。若含概述，也校验标准六列中的国家、版本、语言、指针、原值和编辑值，确认与冻结概述完全一致。报告返回同一个 `workbook_sha256`、扩展候选哈希及概述候选哈希，仍明确 `actual_confirmation_required=true`。

带新增国工作表的集中Excel还应运行标准概述工作簿检查：

```sh
uv run python scripts/market_research/verify_review_workbook.py \
  runtime/market-overview/zmb-review-20260828-r1/review-data.json \
  "outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx" \
  --extension-review runtime/country-extensions/zmb-20260828-r1/review-data.json
```

该检查保留原7张概述表的全部校验，仅在扩展元信息和原始字段、来源均与指定冻结输入一致时，允许3张新增国合同表和可选的 `基础数据阅读`。其他未知表仍拒绝。基础数据阅读必须用公式引用唯一编辑页，不复制第二份数值；验证会核对标签、单位、年份、原编辑行号、数值和来源公式及其缓存，空来源不得变成零。

如需修改字段或正文，应先同步研究底稿/规范化输入，再生成新修订候选和对应审核表。不能只改Excel内容后沿用旧候选哈希，也不能让旧、新两份正文并存为可发布版本。人工仅需确认最终这一份工作簿；系统不代填确认或许可意见。

## 一次确认后的独立发布包

`country_extension_release.py` 消费实际确认记录，生成可重放的 `basic61.seed.v1` 就绪包。旧 `basic60.seed.v1` 模型、固定计数与运行配置不放宽；新增版本只接受本次赞比亚范围：61国（含存档中国）、305条宏观年度记录、61条能源记录、2317个有值观测、62个待补值。既有60国对象、3个来源对象、原始记录与指标定义原样继承；原始中国记录仍不得作为出海目标访问。

这不是新增审核轮次。实际项目批准人确认同一份Excel即可；程序不生成确认，也不将机器检查当作人工作出的决定。确认记录采用 `navigator.country-extension-confirmation.v1`，严格包含以下字段：

| 字段 | 值或绑定 |
| --- | --- |
| `schema_version` | `navigator.country-extension-confirmation.v1` |
| `extension_id` | 冻结扩展候选ID |
| `candidate_sha256` | 冻结 `candidate.json` 的SHA-256 |
| `parent_seed_sha256` | 原Basic60父种子的SHA-256 |
| `workbook_sha256` | 用户实际确认的同一份Excel的SHA-256 |
| `market_overview_candidate_sha256` | 同一Excel绑定的标准概述候选SHA-256 |
| `decision` | 实际确认后的 `approved` |
| `approved_by` | 实际项目批准人 `kevin` |
| `approved_at` | 实际可确定的ISO日期或含时区时间；不补造时分秒 |
| `approval_statement` | 本次实际用户原文 `审核通过` |

本次确认只有日期精度时，记录 `approved_at=2026-08-28`，发布授权保留相同字符串，新增国家及指标的可空 `reviewed_at` 不虚构时间。确认不得在未来，也不得早于审核表创建或信息日期。机器记录时间如有需要，另存日志，不冒充签署时刻。

使用本机既有锁定环境，先由安全的本地环境提供 `BASIC60_RUNTIME_ATTESTATION_KEY`；沿用同一私有运行配置家族的机器信任密钥，不打印、不放在命令行或提交到Git。示例中的确认文件必须已经来自实际用户确认，不能由准备命令自动生成：

```sh
uv run navigator-data prepare-country-extension-release \
  --candidate-dir runtime/country-extensions/zmb-20260828-r1 \
  --workbook "outputs/zmb-20260828-r1/赞比亚新增国家集中审核_20260828.xlsx" \
  --confirmation runtime/country-extensions/confirmations/COUNTRY-EXT-ZMB-20260828-R1.20260828.json \
  --output-dir runtime/basic61/zmb-20260828-r1

uv run navigator-data validate-country-extension-release \
  --release-dir runtime/basic61/zmb-20260828-r1
```

输出必须是 `runtime/basic61` 下尚不存在的新子目录。构建先完整重放父种子、CSV、原始证据、候选和Excel绑定，再验证实际确认；文件在同目录临时位置生成、逐字重放校验后原子创建。已有版本即使内容相同也拒绝覆盖；失败清理临时文件，不改数据库、当前指针、容器或线上配置。

| 发布文件 | 用途 |
| --- | --- |
| `source_collections/country_identity.json`、`macro.json`、`energy.json` | 3个新增域的实际字段及来源集合；保留原官方资料、下载时间、路径、哈希和逐指标 `source_ids` |
| `normalized_seed.json` | 不可直接导入的规范化61国字段快照，供机器字段范围投影 |
| `ai_usage_policy.json` | `basic61.ai-usage-policy.v1` 机器范围投影，不是第二套许可判断 |
| `release_bundle.json` | 父种子、候选、同一Excel、实际确认及派生文件引用 |
| `basic61_validation.json` | `basic61.validation-report.v1`，独立版本的重放结果与严格计数 |
| `basic61_seed.private_trial_ready.json` | `basic61.seed.v1`；完整保留父60国，仅追加赞比亚 |
| `release_authorization.json` | `basic61.release-authorization.v1`；同一实际确认的机械投影，非新增签署 |
| `runtime_attestation.json` | `basic61.runtime-attestation.v1`；绑定最终包、校验、种子与授权哈希的HMAC机器证明 |

新增3个来源分别为 `SRC-BASIC61-ZMB-IDENTITY`、`SRC-BASIC61-ZMB-MACRO`、`SRC-BASIC61-ZMB-ENERGY`，连同父来源共6个。每域原始记录与快照哈希绑定实际集合JSON文件，集合中继续保留每份官方下载证据，不将集合伪装成官方下载原文。`captured_at` 使用该域实际资料的最后捕获时间；`terms_uri` 指向人工已确认审核表的哈希URN，表示许可由人工决定，系统不重新判断许可。

`manual_usage_authorization.field_scope.mode` 保持既有 `all_normalized_basic60_fields`，代表同一Basic私有运行配置家族；字段目录、数量及哈希从本次规范化61国快照重算。允许及禁止用途继承既有人工决定，所有V1模型/向量/在线AI运行开关仍为false。`ai_usage_policy.seed_sha256` 绑定 `normalized_seed.json`，而不是最终就绪种子，避免循环哈希；范围投影绑定同一实际确认，不产生逐字段许可状态。

校验返回 `private_trial_ready`、`formal_gate_status=pending`、`activated=false`。这仅表明新包可供现有私有环境显式导入；不会自动更新线上国家数，不代表正式D4、P0或生产发布。线上切换须由应用层明确选择本次种子、授权与机器证明，并匹配同批概述。旧Basic60包始终保留，可重新选择旧版本回退，不删除历史。

既有市场概述的单国更新、撤回和回退能力继续保留，旧发布文件不受这些命令影响。新增概述仍通过同一Excel、同一实际确认的已有概述流程发布；不得重写或重审既有59国，也不能用旧报告替代缺失概述。

## 机器测试

```sh
uv run ruff format --check .
uv run ruff check .
uv run mypy
uv run pytest tests/data_readiness/test_country_extension.py tests/data_readiness/test_country_extension_release.py --no-cov
```

测试使用合成临时文件，覆盖父版本保全、原始61/海外60范围、数值语义、统计年、来源哈希、冻结输入漂移、重复输出、目录隔离、候选/审核表篡改、单Excel概述绑定、真实确认精度、就绪包逐字重放与HMAC错误密钥。任何后续提交仍执行根目录 `AGENTS.md` 规定的完整检查，不以此定向测试替代正式发布验收。
