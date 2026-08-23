# Navigator 中英双语内部全栈 Demo 运行手册

## 1. 交付范围

本 Demo 由三个真实运行服务组成：

- `web`：Next.js 16、React 19 和 TypeScript 严格模式；
- `api`：Python 3.13、FastAPI、Pydantic 2、SQLAlchemy 2 和 Alembic；
- `db`：PostgreSQL 18，保存可重置的五国合成演示数据。

浏览器通过 Next.js 同源服务端代理访问 API，后端演示密钥不会进入浏览器
JavaScript。共享口令只用于内部展示访问，不是正式账号或企业权限系统。

本轮界面定位为“新能源企业出海工作台 / Global Expansion Workbench”。一级导航为
首页、全球市场、政策与风险、出海工具和合作伙伴；国家对比保留为详情辅助入口，
不再占用一级导航。

## 2. 双语与本地化行为

- 支持`zh-CN`和`en`，默认语言为中文；
- 登录页和登录后页面都提供`中 / EN`切换；
- 选择保存在有效期一年的`navigator_locale` Cookie中，刷新后保持；
- 不增加`/zh`或`/en`路径，切换语言不会改变当前URL；
- 页面`<html lang>`、标题、描述、日期和数字格式跟随当前语言；
- 前端数据查询把`locale=zh-CN|en`传给后端，切换语言会重新请求当前数据，但不重置
  已选国家、表单输入和招标筛选条件；
- 界面词典和英文业务内容均随仓库交付。运行时不调用在线翻译、外部字体或外部模型；
- 每个API响应的`DemoMeta`包含`locale`、`data_origin=synthetic_demo`以及当前语言的
  演示提示。若运行时缺少英文业务文本，后端可以回退中文，但翻译完整性测试必须在
  合并前发现缺漏。

## 3. 启动

前置条件：Docker Desktop已运行，并已启用当前WSL发行版集成。

在仓库根目录的PowerShell中执行：

```powershell
.\scripts\demo-up.cmd
```

首次运行会：

1. 在Git忽略的`.env`生成随机数据库口令、演示口令和会话密钥；
2. 构建`web`与`api`镜像并拉取PostgreSQL 18；
3. 执行Alembic迁移和幂等种子写入；
4. 等待`http://localhost:3000/api/health`通过；
5. 输出访问地址和仅保存在本机的演示口令。

浏览器打开`http://localhost:3000`，输入脚本输出的口令。不要把`.env`、口令或会话
密钥提交到Git、截图到公开材料或复制到外部系统。

## 4. 核心演示路径（v2.1任务链）

1. 在登录页切换一次`中 / EN`，登录后确认语言选择被保留；
2. 在首页地球选择当前市场，使用唯一主行动进入连续任务链；首页到首个工具结果最多
   三次操作：开始当前市场任务 → AI出海助手 → 生成演示建议；
3. 打开“全球市场”，通过地图高亮或单一键盘选择器定位首期合成市场；确认国家详情、
   AI判断、光储、可研、招标和双国对比链接都沿用相同ISO3；
4. 依次进入`/tools?country=<ISO3>`的四个流程：
   - `/tools/assistant`：选择国家和受控问题，生成市场判断、行动和关联依据；
   - `/tools/solar-storage`：输入场景、光伏容量和储能时长，生成概念配置、假设、风险
     和下一步；
   - `/tools/feasibility`：选择国家、项目类型和章节，生成结构化可研草案预览；
   - `/tools/tenders`：按国家、行业、阶段和关键词筛选合成招标，并查看准备动作；
5. 从国家详情进入`/compare`，选择严格两个不同国家，查看评分、差异和推荐路径；
6. 打开政策与风险、机会和合作伙伴页面，确认中英文、筛选及加载/空/错状态；
7. 切换语言，确认当前选国、工具输入和招标筛选未丢失，内容按新`locale`重新请求；
8. 运行重置脚本，确认数据库恢复到确定性五国初始状态。

`/tenders`用于旧链接兼容，会重定向到`/tools/tenders`。正式合同
`POST /api/v1/country-comparisons`仍接受2—4国；本Demo的严格双国行为只使用独立的
`POST /api/v1/demo/country-comparisons`，不修改正式基线合同。

`/tools`、`/tools/assistant`、`/tools/solar-storage`、`/tools/feasibility`和
`/tools/tenders`都接受可选`country=<ISO3>`。只有五个合成演示市场有效；缺失或无效值
确定性回退到首个合成市场，不会查询真实国家或外部来源。

## 5. 动态地球与无障碍回退

动态地球由浏览器本地WebGL渲染。仓库内置裁剪后的Natural Earth 1:110m公共领域
国界轮廓，仅作为界面展示几何，不作为业务证据、法律边界或政治立场。五国名称、摘要、
坐标和准备度仍来自`synthetic_demo`fixture。运行时不下载地图瓦片、地球纹理或第三方
地图脚本，也不发送国家选择给外部服务。

- 鼠标或触控可旋转、拖动、滚轮/捏合缩放；按钮提供放大、缩小、重置和全屏式放大；
- 悬停任一国家面时边界和填充高亮；首期合成市场同时显示双语名称、摘要和准备度；
- 首期五国不再在地球下方以卡片或目录单独列出，使用一个紧凑选择器提供键盘定位；
- 自动旋转在悬停时暂停；系统开启`prefers-reduced-motion`时停止自动旋转并缩短视角
  动画；
- WebGL不可用、地图资产加载失败或被浏览器禁用时，界面显示可键盘操作的市场选择器；
- 国家名称、摘要和准备度随当前语言响应一起更新。

## 6. Demo-only API

以下七个接口仅属于`PBD-ACCEL-DEMO-001`限定的内部演示，不占用正式AI或报告接口：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/v1/demo/globe-markers` | 返回本地WebGL地球的五国坐标、名称、摘要和准备度 |
| `POST` | `/api/v1/demo/country-comparisons` | 严格比较两个不同的三字母国家代码 |
| `POST` | `/api/v1/demo/tools/assistant/preview` | 生成受控问题的模板化AI出海助手预览 |
| `POST` | `/api/v1/demo/tools/solar-storage/preview` | 生成光储概念配置、假设、风险和下一步 |
| `POST` | `/api/v1/demo/tools/feasibility-report/preview` | 生成结构化可研报告草案预览 |
| `GET` | `/api/v1/demo/tools/tenders` | 搜索和筛选合成招标 |
| `GET` | `/api/v1/demo/tools/tenders/{tender_id}` | 查看单条合成招标详情 |

所有接口支持`locale=zh-CN|en`。枚举、ID和数值保持语言无关，标题、摘要、说明和建议
按语言返回。错误响应使用稳定错误代码，前端将错误代码转换为当前语言提示。

工具输出是确定性的`synthetic_demo`预览：AI助手不是自由聊天；光储方案不输出IRR、
LCOE或工程级设计结论；可研报告不生成正式PDF/DOCX；招标记录不是外部实时数据。

## 7. 常用操作与验证

```powershell
# 查看服务和健康状态
docker compose ps
Invoke-WebRequest http://localhost:3000/api/health

# 查看日志
docker compose logs -f
docker compose logs -f api

# 恢复确定性五国合成数据
.\scripts\demo-reset.cmd

# 停止但保留数据
.\scripts\demo-down.cmd

# 停止并删除仅属于demo的数据库卷
.\scripts\demo-down.cmd -RemoveData
```

代码级验证：

```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run typecheck
npm --prefix apps/web run test
npm --prefix apps/web run build
uv run --project services/api --group dev pytest -c services/api/pyproject.toml tests/api
```

发布前还应运行仓库`AGENTS.md`规定的完整质量门。浏览器验收覆盖1600×1000、
1440×900、1024×768和390×844，并检查：无页面横向溢出、无控制台错误、无混合语言或缺失翻译键，
网络面板中不存在外部地图、瓦片、纹理、字体、翻译或模型请求。

## 8. 安全与治理边界

- 所有业务数据必须来自仓库自有`synthetic_demo` fixture；
- 所有页面持续显示“演示数据 / 非正式结论”或
  “Demo Data / Non-official Conclusions”；
- 服务只绑定本机`127.0.0.1`端口，不用于公网暴露；
- 不连接D1候选来源、生产服务、真实用户系统、外部地图、翻译服务或模型；
- 不输入或保存个人信息、真实客户资料、项目秘密或受限材料；
- Demo结果不构成专业建议，也不作为D1—D4、正式V0.1或P0验收证据；
- 本轮不增加业务历史表、报告存储、用户资料、任务队列或生产认证授权。

## 9. 访问受控的远程私有预览

`PBD-ACCEL-DEMO-001`允许把本Demo部署为仅供内部团队使用、访问受控的私有预览，
但不允许匿名公开发布或生产采用。腾讯云部署模板位于`deploy/tencent`，固定使用以下
边界：

- 复用服务器现有Nginx和HTTPS证书，直接进入应用演示口令页，不设置额外的Nginx账号密码；
- Web只绑定服务器回环地址`127.0.0.1:3100`，API和PostgreSQL不映射宿主机端口；
- 使用独立Compose项目、网络、卷和`/opt/navigator`目录，不复用其他项目资源；
- 在开发机完成Linux AMD64镜像构建与质量门，服务器只执行`docker load`和启动，
  不在共享服务器构建或清理其他项目的镜像、缓存和卷；
- 远程环境必须设置`DEMO_COOKIE_SECURE=true`；真实数据库密码、API密钥和会话密钥
  只保存在权限为`0600`的环境文件中，应用演示口令仅分发给获准的内部成员；
- 子域名只提供给获准的内部演示成员，不得邀请外部真实用户，不得输入真实资料，
  也不得把页面内容当作正式结论。

部署、回滚和验收命令见`deploy/tencent/README.md`。任何真实数据、外部模型、正式账号、
匿名访问或生产用途都不属于该模板范围。

## 10. 故障处理

- 端口占用：执行`docker compose ps`，确认本机3000或8000端口未被其他程序占用；
- 数据库未就绪：执行`docker compose logs db api`检查迁移和健康检查；
- 口令丢失：查看本机`.env`中的`NAVIGATOR_DEMO_PASSPHRASE`，不要提交或转发；
- 语言未保持：确认浏览器允许本机站点写入`navigator_locale` Cookie；
- 地球不可见：确认浏览器允许WebGL；即使WebGL不可用，也应出现可操作的市场选择器；
- 完全重建：执行`.\scripts\demo-down.cmd -RemoveData`后重新运行启动脚本。
