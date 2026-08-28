# 赞比亚增量发布记录（2026-08-28）

## 当前站点与范围

- 原站点：<https://navigator.easudata.com/>；赞比亚：<https://navigator.easudata.com/countries/ZMB>。
- 本次切换完成时间：2026-08-28 13:12:34（Asia/Shanghai）。
- 新版为 `BASIC61-PRIVATE-R1`，对客提供60个海外国家，不含中国；原始归档61国含保留的中国记录。
- 赞比亚基础档案、2020—2024宏观指标、已有能源指标及中英文市场概述同时接入原 Demo。
- 原59国基础数据与概述版本不变；仍只有首页、出海工具、合作伙伴三个一级导航。
- 保留已单独批准的匿名入口，不新增登录。正式D1—D4/P0仍为 `pending`，本次记录不代表正式生产门禁通过。

本次仅消费用户对赞比亚集中审核Excel的“审核通过”。没有新增人工签署，未修改已审核文章、原始工作簿或历史审核包。

## 固定部署绑定

| 项目 | 值 |
| --- | --- |
| 新发布目录 | `/opt/navigator/basic60/releases/20260828-zmb-a21a1c9aae25` |
| 旧发布目录 | `/opt/navigator/basic60/releases/20260828-bc52e282b093` |
| Compose项目 | `navigator-basic60-private` |
| Web监听 | `127.0.0.1:3101`；Nginx路由未变 |
| PostgreSQL卷 | `navigator-basic60-private_navigator_basic60_pgdata`；未替换 |
| 概述内容版本 | `OVERVIEW-ZMB-20260828-R1` |
| 概述信息截至 | `2026-08-28` |

应用代码按包含未提交文件的实际源码快照构建，不将这份快照冒充Git提交。本记录对应的腾讯云切换发生在Git提交之前；后续Git同步以仓库提交记录为准，不改变以下已部署源码快照和镜像绑定。

- 源码基准HEAD：`068f2ad358f529e0afd38bc780c478e62b5cf259`。
- 实际源码快照SHA-256：`a21a1c9aae25beabdc1f4f58a559f922444134d82b415d04eea2ca2d5ed28ec3`。
- API镜像：`navigator-basic61-api:release-20260828-zmb-a21a1c9aae25`。
- API镜像ID：`sha256:fd0f3fe7d06f0470c9fa225c8a06b3cd9d40ff2bafb21f8d0e449c33ada57066`。
- Web镜像：`navigator-basic61-web:release-20260828-zmb-a21a1c9aae25`。
- Web镜像ID：`sha256:1d6bc1724c6b684c6b94f1e31cd87812b07fd5ef15ec45ba0af6e604b8892d81`。
- 发布计划SHA-256：`552d5d668a30b4e0b8e77c7106b4591722b9705ca549e21430955b2033661bbc`。
- 原环境文件SHA-256：`b5223c757d2d29ab8299653284e52f0c4b674aab18ec6d6cd9553382c89364cd`。仅记录哈希，不记录密钥。

## 数据、备份和恢复

审核Excel SHA-256为 `4f6e221bf536588d5c4552f642a47951b19d741b8a14e1cea73d00302eeab6c9`；
新ready种子SHA-256为 `fc9015d315de3c6c1a9605b01308e40deca25581df782caaff8b6179ffb3c075`；
完整60国概述manifest为 `0b0b3d6bc46a18d35aeb188028c6d57210818edfdcac3810c4cb8130092f0819`。

云端成功切换前数据库备份：

```text
/opt/navigator/basic60/releases/20260828-zmb-a21a1c9aae25/backups/before-basic61-3252b9a55e5347f29b94884abf277b0d.dump
SHA-256: 35b7e4cdbbd07c277447720d7cff329a7bc2c5885616903b47a9f6252e62ad0e
Bytes: 880799
```

数据库容器、卷、账号与密钥未变。API的5个数据挂载均只读，Web不挂载私有数据；API与数据库无宿主公开端口。原材料和待发布内容没有放入公开静态目录。

本次首次切换因检查脚本将 `/raw%20material/` 的正常308规范化跳转误判为失败而恢复旧版；旧版实际恢复健康，原失败记录保留。独立操作修复文件 `activate_with_canonical_smoke.py` 仅将检查地址改为规范路径 `/raw%20material`，仍只接受403/404，未放宽为200、未修改应用、数据、冻结包或Nginx。

该修复文件SHA-256：`e64a912277889d33247d7f0c35ebea06ae914cfb7267a208b4c0ef493f341140`。后续校验和恢复使用此入口，不直接使用存在误报的原 `cloud_release.py`。

在腾讯云服务器上运行以下只读复验，不输出环境内容：

```bash
sudo python3 /opt/navigator/basic60/releases/20260828-zmb-a21a1c9aae25/activate_with_canonical_smoke.py verify \
  --release /opt/navigator/basic60/releases/20260828-zmb-a21a1c9aae25 \
  --plan-sha256 552d5d668a30b4e0b8e77c7106b4591722b9705ca549e21430955b2033661bbc \
  --old-env-sha256 b5223c757d2d29ab8299653284e52f0c4b674aab18ec6d6cd9553382c89364cd \
  --live
```

明确需要回到旧59国版本时，将上述操作 `verify` 改为 `rollback`，去掉 `--live`；不加 `--apply` 先预检，再显式加 `--apply` 执行。回退仅恢复旧API/Web、旧环境和内容挂载，重新激活旧种子；不删除新旧数据库历史，不执行 `pg_restore` 或删卷。

常规重启已创建容器不会改变版本。若重建服务，应使用本发布目录的 `protected-cloud.env` 和 `compose.approved-basic61.yaml`、原项目名及 `--no-build --pull never --no-deps`，依次处理API、Web；不得套用旧目录命令。重新激活新版应先恢复到旧版并使用本修复入口 `activate`，不能重复运行一次性激活命令作为日常重启。

本机日常重启与回退入口见[本机持久部署说明](../basic60/README.md#current-local-startup-60-overseas-countries)，不依赖临时目录。

## 已执行的在线检查

- 新版203次只读API请求通过：60国详情、120份中英文概述逐值匹配批准包。
- 匿名Web检查11项通过；赞比亚页面200，中国页面404，资料/运行目录不可公开访问。
- 旧59国版本、原环境和旧发布文件保留；回退后的旧版204次API与10项Web检查也已实际通过。
- 后续独立 `verify --live` 再次通过；未泄露API密钥或执行写接口。
- 本机已通过国家筛选、双语详情、地图返回、8张图表和390像素手机布局检查。
- 公网也已通过国家筛选、直接匿名访问、双语概述、8张图表及桌面／手机检查；浏览器错误日志为空，无横向溢出。
- 原1047份材料/旧内容文件哈希复验一致；赞比亚基础数据源绑定离线复验通过。

云端成功操作记录位于同一发布目录的 `activation-success-987b0111c9c445e78ce7c07cf4582fda.json`，SHA-256为 `0fc720b6d4caf4e22d99710556f5c3ccdc57dc45c795fb212f45a462625557e2`。

## 最终仓库回归

最终冻结源码后，以全新进程执行全仓 `pytest --cov`：1135通过、2跳过，覆盖率86.21%（要求85%），退出码0；124份Python及配置文件前后哈希一致。2项跳过是需要 `NAVIGATOR_OVERVIEW_WORKBOOK_QA` 的可选Excel生成集成检查，本轮未重生成审核工作簿，实体文件哈希与已完成的独立验收保持一致。此前仍在收集初稿测试夹具的进程结果由本次完整通过结果替代。

前端752项测试、lint、类型检查及构建通过。Python Ruff格式／静态检查、mypy、基线validate、snapshot及仓库规定的数据准备命令通过，未改变冻结的 `data`／`doc` 基线。

完整收尾记录：`runtime/country-expansion/zmb-20260828-r1/publication.json`；
最终日志及覆盖率：`runtime/country-expansion/zmb-20260828-r1/publication-qa/`。
这些本地资料保留在Git忽略的保护目录内，历史 `handoff.json` 和旧覆盖率文件不覆盖。
