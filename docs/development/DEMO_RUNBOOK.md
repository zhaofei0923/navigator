# Navigator 内部全栈demo运行手册

## 1. 交付范围

本demo由三个真实运行服务组成：

- `web`：Next.js 16、React 19和TypeScript严格模式；
- `api`：FastAPI 0.139兼容线、Pydantic 2、SQLAlchemy 2和Alembic；
- `db`：PostgreSQL 18，保存可重置的五国合成演示数据。

浏览器通过Next.js同源代理访问API，后端演示密钥不会进入浏览器JavaScript。共享口令
只用于内部展示访问，不是正式账号或企业权限系统。

## 2. 启动

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
5. 输出访问地址和本机演示口令。

## 3. 核心演示路径

1. 使用脚本输出的口令进入内部demo；
2. 在首页切换五国，查看五维合成评分、机会动态、进入理由、主要风险和下一步动作；
3. 打开国家详情，核对页面数据来自真实API；
4. 进入国家对比，选择2—4国并提交，查看矩阵、图表、关键差异和推荐路径；
5. 打开政策与风险、项目与招标、伙伴页面，验证筛选和空/错/加载状态；
6. 运行重置脚本，确认数据库恢复到确定性初始状态。

## 4. 常用操作

```powershell
# 查看服务状态
docker compose ps

# 查看所有日志
docker compose logs -f

# 仅查看后端日志
docker compose logs -f api

# 重置合成数据
.\scripts\demo-reset.cmd

# 停止但保留数据
.\scripts\demo-down.cmd

# 停止并删除demo数据库卷
.\scripts\demo-down.cmd -RemoveData
```

## 5. 边界

- 所有业务数据必须包含`synthetic_demo`标识；
- 页面持续显示“演示数据 / 非正式结论”；
- 服务仅绑定本机`127.0.0.1`端口，不用于公网暴露；
- 不连接D1候选来源、生产服务、真实用户系统或外部模型；
- 不保存个人信息、秘密或受限材料；
- demo结果不构成专业建议，也不作为D1—D4验收证据。

## 6. 故障处理

- 端口占用：执行`docker compose ps`，确认本机3000或8000端口未被其他程序占用；
- 数据库未就绪：执行`docker compose logs db api`检查迁移和健康检查；
- 口令丢失：查看本机`.env`中的`NAVIGATOR_DEMO_PASSPHRASE`，不要把它提交到Git；
- 完全重建：执行`.\scripts\demo-down.cmd -RemoveData`后重新运行启动脚本。
