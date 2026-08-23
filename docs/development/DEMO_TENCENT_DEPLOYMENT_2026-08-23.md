# Navigator Demo UI v2.1 腾讯云私有预览发布记录

- 日期：2026-08-23
- 域名：`https://navigator.easudata.com`
- 模式：`access_controlled_private_preview`
- 数据边界：仅仓库自有`synthetic_demo`，不是生产或公开发布

## 发布标识

- 源码快照SHA-256：
  `eef8400a0815fab2c53c31ff84ab55ace90da8c38b120a88be98b202321f85eb`
- Web镜像：`navigator-demo-web:preview-20260823-eef8400a0815`
- API镜像：`navigator-demo-api:preview-20260823-eef8400a0815`
- 镜像归档SHA-256：
  `92dcd199f34a2c7c2fb92f3fcaddc0afdd435eb4ca4150b014145aab2715ec5e`
- 远端归档：`/opt/navigator/navigator-private-preview-eef8400a0815.tar.gz`
- 回退目录：`/opt/navigator/backups/20260823-eef8400a0815-before`

镜像均为Linux AMD64，并带有`synthetic_demo`、私有预览模式和完整源码快照标签。
旧镜像、旧配置和旧环境文件均保留，未清理同机其他项目的镜像、容器、网络或卷。

## 发布与安全调整

- 沿用独立Compose项目、内部网络和外部合成数据卷。
- Web只映射`127.0.0.1:3100`；Navigator API和PostgreSQL没有宿主机端口。
- 将原9位共享口令轮换为48位随机十六进制口令，并同时轮换64位会话密钥；
  数据库密码与API密钥保持不变。
- 初始随机口令未进入仓库或日志，保存在本机
  `/home/kevin/.config/navigator/tencent-private-preview-passphrase.txt`，权限为`0600`。
- Nginx增加登录速率限制、HSTS、CSP，并阻断reset的精确、尾斜杠和编码路径变体。
- 远端环境使用`apply-private-preview-env.py`校验并原子更新，最终权限为`0600`。

## 临时口令轮换

2026-08-23 12:38（Asia/Shanghai），按项目负责人明确指令，将共享口令轮换为一个
恰好8位的临时演示口令，同时重新生成64位随机会话密钥。口令值不写入仓库或部署记录。

- 默认的高熵口令校验保持不变；本次通过双参数显式开启“恰好8位字母数字”受控例外。
- 数据库密码、API密钥、源码快照和镜像引用均确认保持不变。
- 仅重新创建Web容器；API和PostgreSQL容器ID保持不变，三项服务均恢复`healthy`。
- 原48位口令登录返回`401`，新口令登录返回`200`；新Cookie继续包含`Secure`、
  `HttpOnly`和`SameSite=Lax`。
- 使用轮换前会话密钥重建的旧Cookie返回`307`并跳转`/login`，证明旧会话已失效。
- 登录后的首页返回`200`并持续显示“演示数据 / 非正式结论”；健康接口继续返回
  `api=ready`和`data_origin=synthetic_demo`。
- 轮换前环境备份位于
  `/opt/navigator/backups/20260823T-passphrase-rotation.zO5BwY/.env.remote.before`，
  目录权限`0700`、文件权限`0600`。
- 本机受限口令文件已原子改写为当前值，权限保持`0600`。
- Web容器日志中的当前口令和会话密钥匹配数均为0；仓库中的当前口令匹配数为0。
- 轮换辅助程序新增9项定向测试，覆盖默认拒绝弱口令、显式例外边界、会话密钥长度、
  非轮换值保持及符号链接拒绝，全部通过。

该8位口令低于部署手册推荐的128位熵，只适用于短期内部演示。Nginx登录限速继续启用；
演示结束后应立即恢复高熵随机口令。若预览长期保持公网可达，还应叠加安全组IP白名单、
VPN或零信任入口，避免仅依赖共享口令。

## 验收结果

| 项目 | 结果 |
| --- | --- |
| DNS | `navigator.easudata.com`解析到目标CVM |
| TLS | Let's Encrypt通配证书覆盖`*.easudata.com`，有效期至2026-10-06 |
| HTTP | `301`跳转HTTPS |
| 未登录HTTPS首页 | `307`跳转`/login` |
| 登录页 | `200`，真实Chromium渲染成功 |
| 健康接口 | `200`，`api=ready`、`data_origin=synthetic_demo` |
| 错误/正确口令 | 分别返回`401`/`200` |
| 会话Cookie | `Secure`、`HttpOnly`、`SameSite=Lax` |
| 登录限速 | 第5、6次连续错误请求返回`429` |
| 合成市场 | 重启前后均返回5个市场，来源全部为`synthetic_demo` |
| AI助手模板 | 巴西市场进入模板返回`200`和合成数据标识 |
| 双国对比 | `ZAF,BRA`页面返回`200` |
| reset阻断 | 精确、尾斜杠、编码名称、编码斜杠四种请求均返回`403` |
| 受控重启 | 初次发布验证三项服务恢复健康、合成种子有效；本次轮换后旧会话按预期失效 |
| 日志秘密扫描 | 新口令和会话密钥匹配数为0 |

Codex内置浏览器受Windows网络代理影响，不能直接访问该腾讯云域名；独立WSL公网HTTPS
检查正常。为验证真实远端渲染，使用一次性SSH回环隧道加载腾讯云Web容器，确认登录页、
双语入口和演示边界提示正常，随后关闭隧道并确认本地端口已释放。

## 端口检查与共享主机例外

公网`3000`、`3100`、`8100`和`5432`均关闭。共享CVM的`8000`已被无关容器
`gxjn_backend_prod`以`0.0.0.0:8000`公开；Navigator没有使用或修改该容器，Navigator
API仅显示Docker内部`8000/tcp`且无宿主映射。该共享主机级遗留暴露应由对应项目负责人
另行处理，不属于本次Navigator部署的授权范围。
