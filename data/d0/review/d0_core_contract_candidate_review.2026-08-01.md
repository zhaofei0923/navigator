# D0 AC-001/002 候选基线人工复核表

> 本文件是待填复核表，不是批准记录。只有已登记的实名角色持有人可填写。
> 复核通过只允许候选进入正式基线变更流程；不得替换 `doc/doc` 权威工作簿，
> 不得将 D0 或 D4 标记为通过，也不得启动用户侧功能开发。

## 绑定对象

- 权威工作簿 SHA-256：`224e9a35bcbb363cf41c007499ba32aa6394cfdbf06331830c02d994e1c7ddff`
- 整改包：`data/d0/review/core_contract_resolution.2026-08-01.json`
- 整改包文件 SHA-256：`bac2d22c2cdc6019ec01e86c223428e0720cdd16b22fe3b1f08a569fe0a440b8`
- 整改包规范化内容 SHA-256：`3ddefbdf04ce051c7d22dacc289083e73c241d006e15b9dc9d9a563f3910b69e`
- 候选工作簿：`data/d0/candidates/d0_core_contract_candidate.2026-08-01.xlsx`
- 候选工作簿 SHA-256：`123394d0ee1744edf86e201bd1c683cafdd222d1ff5c55221eb1f0798e2f0712`
- 机器评估：`data/d0/candidates/d0_core_contract_candidate_assessment.2026-08-01.json`
- 机器评估文件 SHA-256：`05d95c949382a9014ba8545f48d12a943476ff25b829088bc7cf34eac2acb41e`
- 机器结论：AC-001 `pass`；AC-002 `pass`；校验问题 `0`

## 已应用的实名决定

- 29个缺主键实体各新增一个UUID主键字段；
- 69个非计量字段登记为`不适用`；
- `quota_remaining`登记为`count / count / NAV-UNIT-COUNT-v1`；
- `behavior_score`和`opportunity_score`登记为
  `score_point / dimensionless / NAV-SCORE-0-100-v1`；
- 20个复合字段合同按原顺序拆分为57个原子字段合同；
- 拆分后的`raw_score`和`adjusted_score`沿用已批准的`score_point`注册项，
  其余拆分字段在没有新增单位注册决定时明确登记为`不适用`。

## 人工复核

### D0-AC-001

- 所需角色：数据负责人、后端/数据架构负责人
- 候选哈希结论：`approved` / `rejected`：
- 复核人：
- 复核日期（ISO日期或带时区时间）：
- 证据编号：
- 意见：

### D0-AC-002

- 所需角色：数据负责人、数据质量负责人
- 候选哈希结论：`approved` / `rejected`：
- 复核人：
- 复核日期（ISO日期或带时区时间）：
- 证据编号：
- 意见：
